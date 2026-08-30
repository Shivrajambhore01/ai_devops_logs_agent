import unittest
from pydantic import BaseModel
from app.llm.factory import OllamaLLMProvider, get_llm_provider
from app.core.config import settings

class SampleModel(BaseModel):
    summary: str
    status: str

class TestLLMProvider(unittest.TestCase):
    def test_ollama_provider_init(self):
        provider = OllamaLLMProvider(base_url="http://127.0.0.1:11434", model="qwen2.5-coder")
        self.assertEqual(provider.model, "qwen2.5-coder")
        self.assertEqual(provider.base_url, "http://127.0.0.1:11434")

    def test_ollama_text_fallback_safety(self):
        # Even if Ollama model is downloading, generate_text returns non-empty structured response
        provider = OllamaLLMProvider(base_url="http://127.0.0.1:11434", model="qwen2.5-coder")
        res = provider.generate_text("Explain null check fix for TypeScript")
        self.assertIsInstance(res, str)
        self.assertTrue(len(res) > 0)

    def test_get_llm_provider_ollama(self):
        old_provider = settings.LLM_PROVIDER
        try:
            settings.LLM_PROVIDER = "ollama"
            provider = get_llm_provider()
            self.assertIsInstance(provider, OllamaLLMProvider)
        finally:
            settings.LLM_PROVIDER = old_provider

if __name__ == '__main__':
    unittest.main()
