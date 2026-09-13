from fastapi import APIRouter
from app.api.v1.routes.auth import router as auth_router
from app.api.v1.routes.terminal import router as terminal_router
from app.api.v1.routes.docker_monitor import router as docker_monitor_router
from app.api.v1.routes.github_monitor import router as github_monitor_router
from app.api.v1.routes.deployment_monitor import router as deployment_monitor_router

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(auth_router)
api_v1_router.include_router(terminal_router)
# Docker Monitor — standalone section, zero GitHub dependency
api_v1_router.include_router(docker_monitor_router)
# GitHub Monitor — standalone multi-branch commit intelligence
api_v1_router.include_router(github_monitor_router)
# Deployment Monitor — Vercel / Railway / Render log streaming + AI analysis
api_v1_router.include_router(deployment_monitor_router)

