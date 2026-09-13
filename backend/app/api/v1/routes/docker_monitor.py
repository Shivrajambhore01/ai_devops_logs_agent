"""
Docker Monitor API — Production-Grade Observability.
Provides:
1. Instant container and image listings served from discovery cache (< 1ms).
2. On-demand deep inspection endpoints for containers and images.
3. Keyset/cursor-based error history pagination.
4. Multiplexed and session-specific WebSocket streaming with sequence replay.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from app.core.dependencies import get_current_user_optional
from app.models.user import User
from app.terminal.docker_terminal import docker_terminal_manager
from app.terminal.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/docker", tags=["Docker Monitor"])


# ── Health & Status ────────────────────────────────────────────────────────────

@router.get("/status")
async def docker_status(current_user: User = Depends(get_current_user_optional)) -> Dict[str, Any]:
    """Check Docker daemon health and count cached containers and images."""
    from app.tools.docker.client import docker_wrapper
    available = docker_wrapper.is_available()
    containers = docker_terminal_manager.list_containers()
    images = docker_terminal_manager.list_images()
    running = [c for c in containers if c.get("status") == "running"]

    mode = "live" if available else ("mock" if docker_wrapper.is_mock_allowed() else "offline")

    return {
        "daemon_available": available,
        "total_containers": len(containers),
        "running_containers": len(running),
        "total_images": len(images),
        "mode": mode,
    }


# ── Containers ─────────────────────────────────────────────────────────────────

@router.get("/containers", response_model=List[Dict[str, Any]])
async def list_containers(
    current_user: User = Depends(get_current_user_optional),
) -> List[Dict[str, Any]]:
    """
    Instantaneous listing of all local Docker containers from metadata cache (< 1ms).
    Zero synchronous Docker SDK blocking.
    """
    return docker_terminal_manager.list_containers()


@router.get("/containers/{container_id}", response_model=Dict[str, Any])
async def get_container(
    container_id: str,
    current_user: User = Depends(get_current_user_optional),
) -> Dict[str, Any]:
    """Fetch detailed metadata and inspection attributes for a single container."""
    detail = docker_terminal_manager.get_container_detail(container_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Container '{container_id}' not found")
    return detail


@router.post("/auto-connect")
async def auto_connect_all(
    current_user: User = Depends(get_current_user_optional),
) -> Dict[str, Any]:
    """
    Auto-discover and start streaming ALL running containers.
    Reuses existing active sessions idempotently.
    """
    containers = docker_terminal_manager.list_containers()
    running = [c for c in containers if c.get("status") == "running"]

    session_map: Dict[str, str] = {}
    for c in running:
        cid = c["id"]
        cname = c.get("name", cid)

        existing = docker_terminal_manager.find_session_by_container(cid)
        if existing:
            session_map[cid] = existing.session_id
            continue

        session = docker_terminal_manager.create_session(cid, current_user.id if current_user else 1, container_name=cname)
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
    session = docker_terminal_manager.create_session(container_id, current_user.id if current_user else 1, container_name=cname)
    asyncio.create_task(docker_terminal_manager.start_session(session.session_id))
    return {"session_id": session.session_id, "container_id": container_id, "container_name": cname, "status": "STREAMING"}


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


# ── Images ─────────────────────────────────────────────────────────────────────

@router.get("/images", response_model=List[Dict[str, Any]])
async def list_images(
    current_user: User = Depends(get_current_user_optional),
) -> List[Dict[str, Any]]:
    """
    Instantaneous listing of all cached local Docker images (< 1ms).
    Returns id, repository, tag, size, and container usage count.
    """
    return docker_terminal_manager.list_images()


@router.get("/images/{image_id}", response_model=Dict[str, Any])
async def get_image_detail(
    image_id: str,
    current_user: User = Depends(get_current_user_optional),
) -> Dict[str, Any]:
    """On-demand deep inspection of a specific Docker image."""
    detail = docker_terminal_manager.inspect_image(image_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Image '{image_id}' not found")
    return detail


# ── Error History & Keyset Pagination ──────────────────────────────────────────

@router.get("/errors")
async def list_errors(
    container_id: Optional[str] = None,
    severity: Optional[str] = None,
    hours: Optional[float] = Query(None, description="Filter errors from the last N hours (e.g. 1.0)"),
    since: Optional[str] = Query(None, description="Filter errors created after ISO timestamp"),
    limit: int = 50,
    offset: int = 0,
    before: Optional[str] = None,
    current_user: User = Depends(get_current_user_optional),
) -> List[Dict[str, Any]]:
    """
    Keyset/cursor-paginated list of detected Docker errors with AI summaries.
    Provide 'before' (ISO timestamp) for constant-time keyset pagination.
    Provide 'hours' to filter errors from the last N hours.
    """
    limit = min(limit, 200)
    from app.services.docker_error_service import get_docker_errors
    return await get_docker_errors(
        container_id=container_id,
        severity=severity,
        limit=limit,
        offset=offset,
        before=before,
        hours=hours,
        since=since,
    )


@router.delete("/errors")
async def clear_errors(
    current_user: User = Depends(get_current_user_optional),
) -> Dict[str, Any]:
    """Purge all error logs and AI summaries from the database."""
    from app.services.docker_error_service import clear_all_docker_errors
    deleted = await clear_all_docker_errors()
    return {"status": "cleared", "deleted_count": deleted}


@router.post("/errors/{error_id}/reanalyze")
async def reanalyze_error(
    error_id: str,
    current_user: User = Depends(get_current_user_optional),
) -> Dict[str, Any]:
    """Trigger fresh AI analysis on a specific recorded error."""
    from app.services.docker_error_service import reanalyze_docker_error
    res = await reanalyze_docker_error(error_id)
    if not res:
        raise HTTPException(status_code=404, detail=f"Error {error_id} not found")
    return res


@router.post("/errors/reanalyze-all")
async def reanalyze_all(
    limit: int = Query(default=30, le=100),
    current_user: User = Depends(get_current_user_optional),
) -> Dict[str, Any]:
    """Batch re-analyze recent errors using the updated AI engine."""
    from app.services.docker_error_service import reanalyze_all_docker_errors
    updated = await reanalyze_all_docker_errors(limit=limit)
    return {"status": "completed", "reanalyzed_count": len(updated), "summaries": updated}


# ── WebSocket Streams ──────────────────────────────────────────────────────────

@router.websocket("/stream")
@router.websocket("/stream/{session_id}")
async def docker_stream_ws(
    websocket: WebSocket,
    session_id: Optional[str] = None,
    resume_from: Optional[int] = Query(None),
) -> None:
    """
    WebSocket endpoint supporting both single container streams and dashboard multiplexing.
    - If session_id is provided: streams logs for that specific container session.
    - If omitted (/stream): multiplexes all events across all containers.
    - If resume_from=<seq> is provided: replays missed events upon reconnect.
    """
    channel = session_id or "dashboard"
    await ws_manager.connect(channel, websocket, resume_from=resume_from)
    logger.info(f"[DockerWS] Client connected to channel '{channel}' (resume_from: {resume_from})")

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if data == "ping":
                    await websocket.send_text('{"event_type":"HEARTBEAT"}')
            except asyncio.TimeoutError:
                try:
                    await websocket.send_text('{"event_type":"HEARTBEAT"}')
                except Exception:
                    break
    except WebSocketDisconnect:
        logger.info(f"[DockerWS] Client disconnected from channel '{channel}'")
    finally:
        await ws_manager.disconnect(channel, websocket)
