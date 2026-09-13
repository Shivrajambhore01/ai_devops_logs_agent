"""
WebSocket connection manager for terminal and Docker streaming sessions.
Provides:
1. Per-session and dashboard-wide multiplexed event broadcasting
2. Incremental sequence numbers ('seq') for gapless event tracking
3. Reconnection replay buffer (last 500 events) for 'resume_from' support
4. Non-blocking connection management and dead socket pruning.
"""
from __future__ import annotations
import asyncio
import json
import logging
from collections import defaultdict, deque
from typing import Dict, List, Optional

from fastapi import WebSocket
from app.terminal.event import TerminalEvent

logger = logging.getLogger(__name__)

REPLAY_BUFFER_SIZE = 500


class WebSocketManager:
    """
    Singleton manager holding active WebSocket connections.
    Supports session-specific streaming and multiplexed dashboard streaming.
    """

    def __init__(self) -> None:
        self._connections: Dict[str, List[WebSocket]] = defaultdict(list)
        self._replay_buffers: Dict[str, deque] = defaultdict(lambda: deque(maxlen=REPLAY_BUFFER_SIZE))
        self._seq: int = 0

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    async def connect(self, channel_id: str, ws: WebSocket, resume_from: Optional[int] = None) -> None:
        """Connect client to session or multiplexed channel and replay missed events."""
        await ws.accept()
        self._connections[channel_id].append(ws)
        logger.info(f"[WS] Client connected to channel '{channel_id}' (total: {len(self._connections[channel_id])})")

        # Replay buffered events (all buffered events for new connection, or events > resume_from)
        buffer = self._replay_buffers.get(channel_id)
        if buffer:
            missed = [evt for evt in buffer if (resume_from is None or evt.get("seq", 0) > resume_from)]
            if missed:
                logger.info(f"[WS] Replaying {len(missed)} events to client on channel '{channel_id}'")
                for evt in missed:
                    try:
                        await ws.send_text(json.dumps(evt))
                    except Exception:
                        break

    async def disconnect(self, channel_id: str, ws: WebSocket) -> None:
        clients = self._connections.get(channel_id, [])
        if ws in clients:
            clients.remove(ws)
        if not clients:
            self._connections.pop(channel_id, None)
        logger.info(f"[WS] Client disconnected from channel '{channel_id}'")

    async def broadcast(self, session_id: str, event: TerminalEvent) -> None:
        """Broadcast a TerminalEvent with sequence tagging and replay buffer storage."""
        data = event.to_json()
        await self.broadcast_raw(session_id, data)

    async def broadcast_raw(self, session_id: str, data: dict) -> None:
        """
        Broadcast structured data stamped with incremental sequence number.
        Delivers to both the specific container session and the dashboard stream.
        """
        seq = self._next_seq()
        data["seq"] = seq

        # Append to replay buffers
        self._replay_buffers[session_id].append(data)
        self._replay_buffers["dashboard"].append(data)

        payload = json.dumps(data)

        # Broadcast to session-specific listeners and multiplexed dashboard listeners
        target_channels = {session_id, "dashboard"}
        for channel in target_channels:
            clients = list(self._connections.get(channel, []))
            dead: List[WebSocket] = []
            for ws in clients:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                await self.disconnect(channel, ws)

    def active_session_ids(self) -> List[str]:
        return list(self._connections.keys())

    def connection_count(self, channel_id: str) -> int:
        return len(self._connections.get(channel_id, []))


ws_manager = WebSocketManager()
