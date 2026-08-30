from abc import ABC, abstractmethod
from typing import Type, TypeVar, Optional, Dict, Any
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

class BaseLLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    def generate_text(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Generate plain text response."""
        pass

    @abstractmethod
    def generate_structured(self, prompt: str, response_model: Type[T], system_prompt: Optional[str] = None) -> T:
        """Generate validated Pydantic structured output."""
        pass
