"""Terminal API routes — WebSocket streaming, local process control, and Docker log monitoring."""
from __future__ import annotations
import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel

from app.core.dependencies import get_current_user
from app.models.user import User
from app.terminal.websocket_manager import ws_manager
from app.terminal.local_terminal import local_terminal_manager, ALLOWED_COMMANDS
from app.terminal.docker_terminal import docker_terminal_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/terminal", tags=["Terminal"])


# ── Request / Response Schemas ─────────────────────────────────────────────────

class LocalConnectRequest(BaseModel):
    command: str
    working_dir: str = "."


class DockerConnectRequest(BaseModel):
    container_id: str


class AnalyzeErrorRequest(BaseModel):
    error_text: str
    session_id: Optional[str] = "manual"


class IncidentFromErrorRequest(BaseModel):
    session_id: str
    error_id: str
    title: str
    severity: str = "HIGH"
    service_name: Optional[str] = None


# ── REST Endpoints ─────────────────────────────────────────────────────────────

@router.get("/allowed-commands", response_model=List[str])
async def list_allowed_commands(current_user: User = Depends(get_current_user)):
    """Return list of commands allowed for local terminal sessions."""
    return ALLOWED_COMMANDS


@router.get("/docker-containers", response_model=List[Dict[str, Any]])
async def list_docker_containers(current_user: User = Depends(get_current_user)):
    """List all Docker containers available for log monitoring."""
    return docker_terminal_manager.list_containers()


@router.post("/local", response_model=Dict[str, str], status_code=status.HTTP_201_CREATED)
async def connect_local_terminal(
    payload: LocalConnectRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Create a new local process terminal session.
    Returns session_id for WebSocket connection.
    """
    try:
        session = local_terminal_manager.create_session(
            command=payload.command,
            working_dir=payload.working_dir,
            user_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Start the process asynchronously
    asyncio.create_task(local_terminal_manager.start_session(session.session_id))
    logger.info(f"[Terminal] Local session created: {session.session_id} | cmd: {payload.command}")
    return {"session_id": session.session_id, "status": "STARTING"}


@router.post("/docker", response_model=Dict[str, str], status_code=status.HTTP_201_CREATED)
async def connect_docker_terminal(
    payload: DockerConnectRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Create a new Docker container log monitoring session.
    Returns session_id for WebSocket connection.
    """
    session = docker_terminal_manager.create_session(
        container_id=payload.container_id,
        user_id=current_user.id,
    )
    asyncio.create_task(docker_terminal_manager.start_session(session.session_id))
    logger.info(f"[Terminal] Docker session created: {session.session_id} | container: {payload.container_id}")
    return {"session_id": session.session_id, "status": "STREAMING"}


@router.delete("/local/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def stop_local_terminal(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    """Terminate a running local terminal session."""
    session = local_terminal_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    await local_terminal_manager.stop_session(session_id)
    return None


@router.delete("/docker/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def stop_docker_terminal(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    """Disconnect a Docker container monitoring session."""
    session = docker_terminal_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    await docker_terminal_manager.stop_session(session_id)
    return None


@router.post("/analyze-error")
async def analyze_error(
    payload: AnalyzeErrorRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Manually submit error text for AI analysis.
    Returns structured AIErrorSummary with What/Why/Fix.
    """
    from app.ai.error_analyzer import analyze_text_directly
    try:
        summary = await analyze_text_directly(payload.error_text, payload.session_id or "manual")
        return summary.model_dump()
    except Exception as exc:
        logger.error(f"[Terminal] Manual error analysis failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(exc)}")


@router.post("/create-incident-from-error", status_code=status.HTTP_201_CREATED)
async def create_incident_from_terminal_error(
    payload: IncidentFromErrorRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Level 1 → Level 2 bridge:
    Convert a terminal error summary into a full AI Agent Incident Investigation.
    """
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.core.database import AsyncSessionLocal
    from app.api.v1.routes.incidents import create_incident
    from app.schemas.incident import IncidentCreate

    incident_payload = IncidentCreate(
        title=payload.title,
        description=f"Terminal error detected in session {payload.session_id}. Error ID: {payload.error_id}",
        severity=payload.severity.upper(),
        service_name=payload.service_name or "terminal-session",
        deployment_id="terminal-monitor",
    )

    async with AsyncSessionLocal() as db:
        result = await create_incident(
            payload=incident_payload,
            current_user=current_user,
            db=db,
        )
    return result


# ── WebSocket Endpoint ─────────────────────────────────────────────────────────

@router.websocket("/ws/{session_id}")
async def terminal_websocket(websocket: WebSocket, session_id: str):
    """
    Persistent WebSocket endpoint for real-time terminal streaming.

    Client connects to: ws://127.0.0.1:8000/api/v1/terminal/ws/{session_id}
    Receives: TerminalEvent JSON objects in real-time.
    """
    await ws_manager.connect(session_id, websocket)
    logger.info(f"[WS] Client connected to terminal session: {session_id}")

    try:
        # Keep connection alive — ping/pong heartbeat
        while True:
            try:
                # Wait for client messages (e.g. heartbeat pings)
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if data == "ping":
                    await websocket.send_text('{"event_type":"HEARTBEAT"}')
            except asyncio.TimeoutError:
                # Send heartbeat to keep connection alive
                try:
                    await websocket.send_text('{"event_type":"HEARTBEAT"}')
                except Exception:
                    break
    except WebSocketDisconnect:
        logger.info(f"[WS] Client disconnected from session: {session_id}")
    finally:
        await ws_manager.disconnect(session_id, websocket)
