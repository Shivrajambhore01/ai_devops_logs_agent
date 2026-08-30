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
    "models/gemini-2.0-flash",
    "models/gemini-1.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "models/gemini-1.5-pro",
]

class GeminiLLMProvider(BaseLLMProvider):
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.fallback = FallbackLLMProvider()

    def generate_text(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
        
        for model_name in GEMINI_MODELS:
            try:
                model = genai.GenerativeModel(model_name)
                res = model.generate_content(full_prompt)
                if res and res.text:
                    return res.text.strip()
            except Exception as err:
                logger.warning(f"Gemini model '{model_name}' failed: {err}")

        # If quota is exceeded (429) or all Gemini calls fail, use clean fallback
        logger.info("Gemini API unavailable or quota exceeded — using clean contextual fallback.")
        return self.fallback.generate_text(prompt, system_prompt)

    def generate_structured(self, prompt: str, response_model: Type[T], system_prompt: Optional[str] = None) -> T:
        try:
            text = self.generate_text(prompt, system_prompt)
            clean_text = text.replace("```json", "").replace("```", "").strip()
            data = json.loads(clean_text)
            return response_model(**data)
        except Exception:
            return self.fallback.generate_structured(prompt, response_model, system_prompt)

class OllamaLLMProvider(BaseLLMProvider):
    """High-performance provider for Qwen 2.5 & local LLMs via Ollama API."""
    def __init__(self, base_url: str = "http://127.0.0.1:11434", model: str = "qwen2.5-coder"):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.fallback = FallbackLLMProvider()

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
                "num_thread": 8
            }
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            # Fast timeout for local LLM inference (max 10s)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                response_text = data.get("response", "").strip()
                if response_text:
                    logger.info(f"Successfully received response from Ollama model '{self.model}'")
                    return response_text
        except Exception as err:
            logger.warning(f"Ollama Qwen model '{self.model}' unavailable or timed out ({err}). Using contextual fallback.")
        
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
                "num_thread": 8
            }
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                raw_json = data.get("response", "").strip()
                clean_text = raw_json.replace("```json", "").replace("```", "").strip()
                parsed = json.loads(clean_text)
                return response_model(**parsed)
        except Exception as err:
            logger.warning(f"Ollama structured JSON generation failed ({err}). Using fallback.")
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


