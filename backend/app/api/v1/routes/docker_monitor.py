"""
Docker Monitor API — completely standalone section.
Streams Docker container logs with AI-powered error analysis.

Routes:
  GET  /api/v1/docker/containers               → List all containers
  POST /api/v1/docker/auto-connect             → Connect all running containers
  POST /api/v1/docker/containers/{id}/connect  → Connect single container
  DELETE /api/v1/docker/sessions/{session_id}  → Disconnect session
  GET  /api/v1/docker/errors                   → Paginated error history
  GET  /api/v1/docker/status                   → Docker daemon health
  WS   /api/v1/docker/stream/{session_id}      → Real-time log + AI events

NO dependency on GitHub, incidents, repositories, or webhooks.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status

from app.core.dependencies import get_current_user_optional
from app.models.user import User
from app.terminal.docker_terminal import docker_terminal_manager
from app.terminal.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/docker", tags=["Docker Monitor"])


# ── Health ─────────────────────────────────────────────────────────────────────

@router.get("/status")
async def docker_status(current_user: User = Depends(get_current_user_optional)) -> Dict[str, Any]:
    """Check if the local Docker daemon is reachable."""
    from app.tools.docker.client import docker_wrapper
    available = docker_wrapper.is_available()
    containers = docker_terminal_manager.list_containers() if available else []
    running = [c for c in containers if c.get("status") == "running"]
    return {
        "daemon_available": available,
        "total_containers": len(containers),
        "running_containers": len(running),
        "mode": "live" if available else "mock",
    }


# ── Containers ─────────────────────────────────────────────────────────────────

@router.get("/containers", response_model=List[Dict[str, Any]])
async def list_containers(
    current_user: User = Depends(get_current_user_optional),
) -> List[Dict[str, Any]]:
    """
    List all local Docker containers.
    Returns id, name, status, image, ports for each container. Non-blocking.
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, docker_terminal_manager.list_containers)


@router.post("/auto-connect")
async def auto_connect_all(
    current_user: User = Depends(get_current_user_optional),
) -> Dict[str, Any]:
    """
    Auto-discover and start streaming ALL running containers.
    Returns { sessions: { container_id: session_id }, containers: [...] }.
    Idempotent — reuses an existing active session if one already exists.
    """
    loop = asyncio.get_event_loop()
    containers = await loop.run_in_executor(None, docker_terminal_manager.list_containers)
    running = [c for c in containers if c.get("status") == "running"]

    session_map: Dict[str, str] = {}
    for c in running:
        cid = c["id"]
        cname = c.get("name", cid)

        # Reuse existing active session
        existing = docker_terminal_manager.find_session_by_container(cid)
        if existing:
            session_map[cid] = existing.session_id
            logger.debug(f"[DockerMonitor] Reusing session {existing.session_id} for {cname}")
            continue

        session = docker_terminal_manager.create_session(cid, current_user.id, container_name=cname)
        asyncio.create_task(docker_terminal_manager.start_session(session.session_id))
        session_map[cid] = session.session_id
        logger.info(f"[DockerMonitor] Auto-connected {cname} → {session.session_id}")

    return {
        "sessions": session_map,
        "containers": containers,
    }


@router.post(
    "/containers/{container_id}/connect",
    response_model=Dict[str, str],
    status_code=status.HTTP_201_CREATED,
)
async def connect_single_container(
    container_id: str,
    current_user: User = Depends(get_current_user_optional),
) -> Dict[str, str]:
    """Connect and begin streaming a specific container by ID."""
    containers = docker_terminal_manager.list_containers()
    meta = next((c for c in containers if c["id"] == container_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail=f"Container '{container_id}' not found")
    if meta.get("status") != "running":
        raise HTTPException(status_code=400, detail=f"Container '{container_id}' is not running (status: {meta.get('status')})")

    cname = meta.get("name", container_id)
    session = docker_terminal_manager.create_session(container_id, current_user.id, container_name=cname)
    asyncio.create_task(docker_terminal_manager.start_session(session.session_id))
    logger.info(f"[DockerMonitor] Single connect: {cname} → {session.session_id}")
    return {"session_id": session.session_id, "container_id": container_id, "container_name": cname, "status": "STREAMING"}


from fastapi.responses import Response

@router.delete("/sessions/{session_id}")
async def disconnect_session(
    session_id: str,
    current_user: User = Depends(get_current_user_optional),
) -> dict:
    """Stop a Docker container streaming session."""
    session = docker_terminal_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    await docker_terminal_manager.stop_session(session_id)
    return {"status": "stopped", "session_id": session_id}


# ── Error History ──────────────────────────────────────────────────────────────

@router.get("/errors")
async def list_errors(
    container_id: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user_optional),
) -> List[Dict[str, Any]]:
    """
    Paginated list of detected Docker errors with AI summaries.
    Persisted in database — survives page refreshes and backend restarts.

    Query params:
      container_id  Filter by specific container
      severity      Filter: ERROR | CRITICAL
      limit         Page size (default 50, max 200)
      offset        Pagination offset
    """
    limit = min(limit, 200)
    from app.services.docker_error_service import get_docker_errors
    return await get_docker_errors(
        container_id=container_id,
        severity=severity,
        limit=limit,
        offset=offset,
    )


# ── WebSocket Stream ───────────────────────────────────────────────────────────

@router.websocket("/stream/{session_id}")
async def docker_stream_ws(websocket: WebSocket, session_id: str) -> None:
    """
    Persistent WebSocket for real-time Docker log streaming + AI analysis events.

    Client connects to: ws://127.0.0.1:8000/api/v1/docker/stream/{session_id}

    Incoming events (JSON):
      OUTPUT              → Normal log line
      STACKTRACE          → Error log line
      CONTAINER_STARTED   → Session connected
      CONTAINER_STOPPED   → Stream ended / container stopped
      AI_ANALYSIS_STARTED → LLM began analyzing an error
      AI_ANALYSIS_COMPLETED → Structured AI summary ready (contains ai_summary object)
      HEARTBEAT           → Keep-alive ping/pong

    Send "ping" to receive a HEARTBEAT response.
    """
    await ws_manager.connect(session_id, websocket)
    logger.info(f"[DockerWS] Client connected to session: {session_id}")

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if data == "ping":
                    await websocket.send_text('{"event_type":"HEARTBEAT"}')
            except asyncio.TimeoutError:
                # Server-side heartbeat to keep connection alive
                try:
                    await websocket.send_text('{"event_type":"HEARTBEAT"}')
                except Exception:
                    break
    except WebSocketDisconnect:
        logger.info(f"[DockerWS] Client disconnected from session: {session_id}")
    finally:
        await ws_manager.disconnect(session_id, websocket)
