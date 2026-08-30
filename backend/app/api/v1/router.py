from fastapi import APIRouter
from app.api.v1.routes.auth import router as auth_router
from app.api.v1.routes.incidents import router as incidents_router
from app.api.v1.routes.repositories import router as repositories_router
from app.api.v1.routes.agent_runs import router as agent_runs_router
from app.api.v1.routes.fixes import router as fixes_router
from app.api.v1.routes.webhooks import router as webhooks_router
from app.api.v1.routes.terminal import router as terminal_router
from app.api.v1.routes.docker_monitor import router as docker_monitor_router

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(auth_router)
api_v1_router.include_router(incidents_router)
api_v1_router.include_router(repositories_router)
api_v1_router.include_router(agent_runs_router)
api_v1_router.include_router(fixes_router)
api_v1_router.include_router(webhooks_router)
api_v1_router.include_router(terminal_router)
# Docker Monitor — standalone section, zero GitHub dependency
api_v1_router.include_router(docker_monitor_router)
