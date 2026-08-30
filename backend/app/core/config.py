import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

# Compute absolute paths to backend .env and root .env
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
root_dir = os.path.abspath(os.path.join(backend_dir, ".."))

backend_env = os.path.join(backend_dir, ".env")
root_env = os.path.join(root_dir, ".env")

target_env = backend_env if os.path.exists(backend_env) else root_env
if os.path.exists(target_env):
    load_dotenv(target_env, override=True)

class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    # API
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    SECRET_KEY: str = "change-this-super-secret-key-in-production-32-bytes!"

    # Database (Enforce 127.0.0.1 for asyncpg on Windows)
    DATABASE_URL: str = "postgresql+asyncpg://postgres:Shivraj@8010@127.0.0.1:5432/devops_agent"
    
    # Redis
    REDIS_URL: str = "redis://127.0.0.1:6379/0"

    # LLM Options
    LLM_PROVIDER: str = "gemini"  # ollama, gemini, openai
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "qwen2.5-coder"
    GEMINI_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None

    # GitHub Integration
    GITHUB_TOKEN: Optional[str] = None
    GITHUB_WEBHOOK_SECRET: Optional[str] = None

    # Sandbox Config
    SANDBOX_DOCKER_IMAGE: str = "python:3.12-slim"
    SANDBOX_TIMEOUT_SECONDS: int = 120

    model_config = SettingsConfigDict(
        env_file=target_env if os.path.exists(target_env) else ".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    def __init__(self, **values):
        super().__init__(**values)
        if "localhost" in self.DATABASE_URL:
            self.DATABASE_URL = self.DATABASE_URL.replace("localhost", "127.0.0.1")

settings = Settings()
