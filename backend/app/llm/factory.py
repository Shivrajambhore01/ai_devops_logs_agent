import json
import urllib.request
import logging
from typing import Type, TypeVar, Optional
from pydantic import BaseModel
import google.generativeai as genai
from app.core.config import settings
from app.llm.provider import BaseLLMProvider
from app.llm.mock_llm import FallbackLLMProvider

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

GEMINI_MODELS = [
    "models/gemini-3.6-flash",
    "models/gemini-flash-lite-latest",
    "models/gemini-flash-latest",
    "models/gemini-2.5-pro",
]

class OllamaLLMProvider(BaseLLMProvider):
    """High-performance provider for Qwen 2.5 & local LLMs via Ollama API."""
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:11434",
        model: str = "qwen2.5-coder",
        enable_gemini_fallback: bool = True,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.fallback = FallbackLLMProvider()
        self.gemini_fallback: Optional[GeminiLLMProvider] = None

        if enable_gemini_fallback and settings.GEMINI_API_KEY:
            try:
                # Prevent recursive fallback
                self.gemini_fallback = GeminiLLMProvider(
                    settings.GEMINI_API_KEY,
                    enable_ollama_fallback=False,
                )
            except Exception:
                self.gemini_fallback = None

    def generate_text(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        url = f"{self.base_url}/api/generate"
        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": system_prompt or "You are an expert DevOps engineer and senior software developer.",
            "stream": False,
            "keep_alive": "15m",
            "options": {
                "temperature": 0.2,
                "top_p": 0.9,
                "num_predict": 400,
                "num_thread": 8,
            },
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            # Fast timeout for local LLM inference (max 30s)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                response_text = data.get("response", "").strip()
                if response_text:
                    logger.info(f"Successfully received response from Ollama model '{self.model}'")
                    return response_text
        except Exception as err:
            logger.warning(f"Ollama Qwen model '{self.model}' unavailable or timed out ({err}). Trying secondary providers.")

        if self.gemini_fallback:
            try:
                return self.gemini_fallback.generate_text(prompt, system_prompt)
            except Exception as gemini_err:
                logger.warning(f"Secondary Gemini fallback failed: {gemini_err}")

        return self.fallback.generate_text(prompt, system_prompt)

    def generate_structured(self, prompt: str, response_model: Type[T], system_prompt: Optional[str] = None) -> T:
        url = f"{self.base_url}/api/generate"
        json_schema_prompt = f"{prompt}\nReturn your answer strictly in valid JSON matching the schema for {response_model.__name__}."
        payload = {
            "model": self.model,
            "prompt": json_schema_prompt,
            "system": system_prompt or "You output strictly valid JSON.",
            "format": "json",
            "stream": False,
            "keep_alive": "15m",
            "options": {
                "temperature": 0.1,
                "num_predict": 768,
                "num_thread": 8,
            },
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=35) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                raw_json = data.get("response", "").strip()
                clean_text = raw_json.replace("```json", "").replace("```", "").strip()
                parsed = json.loads(clean_text)
                return response_model(**parsed)
        except Exception as err:
            logger.warning(f"Ollama structured JSON generation failed ({err}). Trying secondary fallback.")
            if self.gemini_fallback:
                try:
                    return self.gemini_fallback.generate_structured(prompt, response_model, system_prompt)
                except Exception as gemini_err:
                    logger.warning(f"Secondary Gemini fallback structured generation failed: {gemini_err}")
            return self.fallback.generate_structured(prompt, response_model, system_prompt)


class GeminiLLMProvider(BaseLLMProvider):
    """Google Gemini live provider with automatic local Ollama (Qwen) + static fallbacks."""
    def __init__(self, api_key: str, enable_ollama_fallback: bool = True):
        genai.configure(api_key=api_key)
        self.fallback = FallbackLLMProvider()
        self.ollama_fallback: Optional[OllamaLLMProvider] = None

        if enable_ollama_fallback:
            try:
                # Initialize Ollama as backup with recursive fallback disabled
                self.ollama_fallback = OllamaLLMProvider(
                    base_url=settings.OLLAMA_BASE_URL,
                    model=settings.OLLAMA_MODEL,
                    enable_gemini_fallback=False,
                )
            except Exception as e:
                logger.warning(f"Could not configure Ollama fallback inside Gemini provider: {e}")
                self.ollama_fallback = None

    def generate_text(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt

        # 1. Try Gemini models in priority order
        for model_name in GEMINI_MODELS:
            try:
                model = genai.GenerativeModel(model_name)
                res = model.generate_content(full_prompt)
                if res and res.text:
                    return res.text.strip()
            except Exception as err:
                logger.warning(f"Gemini model '{model_name}' failed: {err}")

        # 2. If all Gemini models fail (rate-limit / 429 / network down), fall back to local Ollama (Qwen)
        if self.ollama_fallback:
            logger.info("All Gemini cloud models unavailable — failing over to local Ollama (Qwen)...")
            try:
                text = self.ollama_fallback.generate_text(prompt, system_prompt)
                if text:
                    logger.info("Successfully recovered using local Ollama backup!")
                    return text
            except Exception as ollama_err:
                logger.warning(f"Local Ollama backup also failed: {ollama_err}")

        # 3. Final safety net: clean rule-based fallback
        logger.info("Gemini & Ollama both unavailable — using clean contextual fallback.")
        return self.fallback.generate_text(prompt, system_prompt)

    def generate_structured(self, prompt: str, response_model: Type[T], system_prompt: Optional[str] = None) -> T:
        try:
            text = self.generate_text(prompt, system_prompt)
            clean_text = text.replace("```json", "").replace("```", "").strip()
            data = json.loads(clean_text)
            return response_model(**data)
        except Exception as parse_err:
            logger.warning(f"Structured JSON parsing from Gemini failed: {parse_err}")

        # Try local Ollama structured generation directly
        if self.ollama_fallback:
            try:
                logger.info("Falling back to local Ollama for structured generation...")
                return self.ollama_fallback.generate_structured(prompt, response_model, system_prompt)
            except Exception as ollama_err:
                logger.warning(f"Ollama structured fallback failed: {ollama_err}")

        return self.fallback.generate_structured(prompt, response_model, system_prompt)


def get_llm_provider() -> BaseLLMProvider:
    """Factory function returning configured live LLM provider."""
    provider = settings.LLM_PROVIDER.lower()

    if provider in ["ollama", "qwen"]:
        logger.info(f"Initializing Ollama Qwen provider ({settings.OLLAMA_MODEL}) at {settings.OLLAMA_BASE_URL}")
        return OllamaLLMProvider(base_url=settings.OLLAMA_BASE_URL, model=settings.OLLAMA_MODEL)

    if provider == "gemini" and settings.GEMINI_API_KEY:
        try:
            return GeminiLLMProvider(settings.GEMINI_API_KEY)
        except Exception as e:
            logger.error(f"Error initializing Gemini LLM provider: {e}")

    if settings.GEMINI_API_KEY:
        return GeminiLLMProvider(settings.GEMINI_API_KEY)

    return FallbackLLMProvider()

llm = get_llm_provider()



