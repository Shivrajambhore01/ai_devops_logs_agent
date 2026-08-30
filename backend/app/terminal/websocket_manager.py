"""
WebSocket connection manager for terminal sessions.
Maintains a registry of active WebSocket connections per session_id
and broadcasts TerminalEvents to all connected clients.
"""
from __future__ import annotations
import asyncio
import json
import logging
from collections import defaultdict
from typing import Dict, List, Optional

from fastapi import WebSocket

from app.terminal.event import TerminalEvent

logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    Singleton manager that holds all active WebSocket connections keyed by session_id.
    Thread-safe for asyncio event loop.
    """

    def __init__(self) -> None:
        # session_id -> list of connected WebSocket clients
        self._connections: Dict[str, List[WebSocket]] = defaultdict(list)

    async def connect(self, session_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[session_id].append(ws)
        logger.info(f"[WS] Client connected to session {session_id} (total: {len(self._connections[session_id])})")

    async def disconnect(self, session_id: str, ws: WebSocket) -> None:
        clients = self._connections.get(session_id, [])
        if ws in clients:
            clients.remove(ws)
        if not clients:
            self._connections.pop(session_id, None)
        logger.info(f"[WS] Client disconnected from session {session_id}")

    async def broadcast(self, session_id: str, event: TerminalEvent) -> None:
        """Broadcast a TerminalEvent to all clients subscribed to session_id."""
        clients = list(self._connections.get(session_id, []))
        dead: List[WebSocket] = []
        payload = json.dumps(event.to_json())

        for ws in clients:
            try:
                await ws.send_text(payload)
            except Exception as exc:
                logger.warning(f"[WS] Failed to send to client: {exc}")
                dead.append(ws)

        # Prune dead connections
        for ws in dead:
            await self.disconnect(session_id, ws)

    async def broadcast_raw(self, session_id: str, data: dict) -> None:
        """Broadcast a raw dict payload directly."""
        clients = list(self._connections.get(session_id, []))
        dead: List[WebSocket] = []
        payload = json.dumps(data)
        for ws in clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(session_id, ws)

    def active_session_ids(self) -> List[str]:
        return list(self._connections.keys())

    def connection_count(self, session_id: str) -> int:
        return len(self._connections.get(session_id, []))


# Global singleton
ws_manager = WebSocketManager()
