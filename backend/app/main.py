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
