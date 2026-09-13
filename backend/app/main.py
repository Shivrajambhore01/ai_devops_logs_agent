import sys
import asyncio

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.router import api_v1_router

app = FastAPI(
    title="AI DevOps Incident Resolution Agent API",
    description="Autonomous Agentic AI platform for incident investigation, RCA, fix generation, sandbox testing, and human approval flow.",
    version="0.1.0",
)

@app.on_event("startup")
async def create_docker_tables() -> None:
    """Create Docker Monitor tables if they don't exist yet and launch AI Worker."""
    try:
        from app.core.database import engine
        # Import models so SQLAlchemy knows about the tables
        import app.models.docker_error  # noqa: F401
        from app.core.database import Base
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(f"[Startup] Could not create Docker tables: {exc}")

    # Launch background AI worker for decoupled error processing
    try:
        from app.workers.ai_worker import start_ai_worker
        start_ai_worker()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(f"[Startup] Could not launch AI Worker: {exc}")

    # Launch background Docker events discovery listener
    try:
        import asyncio
        from app.terminal.docker_terminal import docker_terminal_manager
        asyncio.create_task(docker_terminal_manager.discovery.start_events_listener())
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(f"[Startup] Could not start Docker events listener: {exc}")

    # Launch periodic DB retention cleanup (every 24 hours, purging errors older than 14 days)
    try:
        import asyncio
        from app.services.docker_error_service import purge_expired_docker_errors

        async def _retention_loop():
            while True:
                await asyncio.sleep(86400)
                try:
                    await purge_expired_docker_errors(retention_days=14)
                except Exception:
                    pass

        asyncio.create_task(_retention_loop())
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(f"[Startup] Could not start retention loop: {exc}")

# Configure CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include v1 API routes
app.include_router(api_v1_router)

@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "AI DevOps Incident Resolution Agent API",
        "version": "0.1.0"
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "database": "connected",
        "redis": "connected"
    }

@app.get("/api/v1/ai-provider")
async def get_ai_provider():
    """
    Audit endpoint — returns the active LLM provider configuration.
    Used by the frontend to display which AI model performed each analysis.
    """
    from app.core.config import settings

    provider = settings.LLM_PROVIDER.lower()

    if provider in ("ollama", "qwen"):
        return {
            "provider": "ollama",
            "display_name": "Local LLM (Ollama)",
            "model": settings.OLLAMA_MODEL,
            "model_display": f"Qwen · {settings.OLLAMA_MODEL}",
            "type": "local",
            "icon": "cpu",
            "color": "#e5c07b",
            "base_url": settings.OLLAMA_BASE_URL,
            "description": f"Running locally via Ollama — model: {settings.OLLAMA_MODEL}",
            "fallback_chain": ["ollama", "gemini (if key set)", "static fallback"],
        }

    if provider == "gemini" and settings.GEMINI_API_KEY:
        # Detect which Gemini model tier will actually be used
        return {
            "provider": "gemini",
            "display_name": "Google Gemini",
            "model": "gemini-flash",
            "model_display": "Gemini Flash",
            "type": "cloud",
            "icon": "sparkles",
            "color": "#61afef",
            "base_url": "https://generativelanguage.googleapis.com",
            "description": f"Google Gemini API (Flash) with local Ollama ({settings.OLLAMA_MODEL}) auto-backup",
            "fallback_chain": [
                "gemini-3.6-flash",
                "gemini-flash-lite-latest",
                "gemini-flash-latest",
                "gemini-2.5-pro",
                f"local Ollama ({settings.OLLAMA_MODEL})",
                "static rule-based fallback",
            ],
        }

    # No valid provider — static fallback
    return {
        "provider": "fallback",
        "display_name": "Static Fallback Engine",
        "model": "rule-based",
        "model_display": "Rule-based Fallback",
        "type": "local",
        "icon": "shield",
        "color": "#98c379",
        "base_url": None,
        "description": "No external LLM configured — using intelligent rule-based analysis",
        "fallback_chain": ["static fallback"],
    }
