"""
Docker terminal manager.
Streams Docker container logs using the Docker SDK in a non-blocking fashion.
Uses a producer/consumer Queue so every log line is broadcast the instant
Docker writes it — without ever blocking the asyncio event loop.
Falls back to realistic mock data when Docker daemon is unavailable.
"""
from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.terminal.event import EventType, LogLevel, TerminalEvent
from app.terminal.error_detector import ErrorDetector
from app.terminal.websocket_manager import ws_manager
from app.tools.docker.client import docker_wrapper

logger = logging.getLogger(__name__)


class DockerSession:
    def __init__(self, session_id: str, container_id: str, container_name: str, user_id: int):
        self.session_id    = session_id
        self.container_id  = container_id
        self.container_name = container_name
        self.user_id       = user_id
        self.status        = "CONNECTING"
        self.created_at    = datetime.now(timezone.utc).isoformat()
        self._detector     = ErrorDetector(session_id, self._on_error)
        self._errors: list = []
        self._task: Optional[asyncio.Task] = None

    async def _on_error(self, normalized_error) -> None:
        """Called by ErrorDetector when a complete error event is flushed."""
        self._errors.append(normalized_error)

        # 1. Immediately notify frontend over WebSocket with structured error event
        try:
            await ws_manager.broadcast_raw(
                self.session_id,
                {
                    "event_type": EventType.ERROR_DETECTED,
                    "session_id": self.session_id,
                    "level": "ERROR",
                    "error": {
                        "id": normalized_error.id,
                        "error_id": normalized_error.id,
                        "session_id": self.session_id,
                        "container_id": self.container_id,
                        "container_name": self.container_name,
                        "language": normalized_error.language,
                        "error_type": normalized_error.error_type,
                        "error_message": normalized_error.error_message,
                        "file_path": normalized_error.file_path,
                        "line_number": normalized_error.line_number,
                        "raw_stack_trace": normalized_error.raw_stack_trace,
                        "severity": normalized_error.severity,
                        "timestamp": normalized_error.timestamp,
                    },
                },
            )
        except Exception as exc:
            logger.warning(f"[DockerSession] Broadcast ERROR_DETECTED failed: {exc}")

        # 2. Fast Redis fingerprint check + Queue Enqueue (< 1ms)
        try:
            from app.services.queue_service import is_error_duplicate, enqueue_error_job
            import hashlib
            fingerprint_parts = f"{normalized_error.error_type or 'unknown'}|{normalized_error.error_message[:100]}|{normalized_error.file_path or ''}"
            error_hash = hashlib.sha256(fingerprint_parts.encode()).hexdigest()[:16]

            if await is_error_duplicate(error_hash, self.container_id):
                logger.debug(f"[DockerSession] Skipping duplicate LLM job {error_hash} for {self.container_name}")
                return

            payload = {
                "error_id": normalized_error.id,
                "session_id": self.session_id,
                "container_id": self.container_id,
                "container_name": self.container_name,
                "language": normalized_error.language,
                "error_type": normalized_error.error_type,
                "error_message": normalized_error.error_message,
                "file_path": normalized_error.file_path,
                "line_number": normalized_error.line_number,
                "raw_stack_trace": normalized_error.raw_stack_trace,
                "severity": normalized_error.severity,
            }
            await enqueue_error_job(payload)
        except Exception as exc:
            logger.warning(f"[DockerSession] Redis enqueue error: {exc}")

    async def _broadcast(self, message: str, level: LogLevel = LogLevel.INFO, event_type: EventType = EventType.OUTPUT) -> None:
        event = TerminalEvent(
            session_id=self.session_id,
            source="docker",
            container=self.container_id,
            level=level,
            message=message,
            event_type=event_type,
        )
        await ws_manager.broadcast(self.session_id, event)

    async def start(self) -> None:
        self.status = "STREAMING"
        await self._broadcast(f"▶ Connected to container: {self.container_id}", LogLevel.INFO, EventType.CONTAINER_STARTED)
        self._task = asyncio.create_task(self._stream_logs())

    async def _stream_logs(self) -> None:
        """Real-time log streaming via producer/consumer Queue."""
        if not docker_wrapper.is_available():
            await self._stream_mock_logs()
            return

        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=500)

        def _producer() -> None:
            """
            Blocking Docker SDK iterator — runs in a thread.
            Each line is put into the asyncio Queue immediately.
            """
            try:
                client = docker_wrapper.get_client()
                container = client.containers.get(self.container_id)
                for raw_bytes in container.logs(stream=True, follow=True, tail=100):
                    asyncio.run_coroutine_threadsafe(queue.put(raw_bytes), loop)
            except Exception as exc:
                logger.error(f"[DockerTerminal] Producer error for {self.container_id}: {exc}")
            finally:
                # Sentinel — tells consumer the stream ended
                asyncio.run_coroutine_threadsafe(queue.put(None), loop)

        # Launch producer in thread executor — don't await it
        loop.run_in_executor(None, _producer)

        # Async consumer — receives each line the moment Docker writes it
        try:
            while True:
                raw_bytes = await queue.get()
                if raw_bytes is None:          # Sentinel received — stream ended
                    break
                line = raw_bytes.decode("utf-8", errors="replace").rstrip()
                if not line:
                    continue
                level = await self._detector.feed_line(line)
                event_type = EventType.STACKTRACE if level == LogLevel.ERROR else EventType.OUTPUT
                await self._broadcast(line, level, event_type)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error(f"[DockerTerminal] Consumer error for {self.container_id}: {exc}")
            await self._broadcast(f"⚠ Stream error: {exc}", LogLevel.ERROR, EventType.CONTAINER_STOPPED)
            self.status = "ERROR"

    async def _stream_mock_logs(self) -> None:
        """Realistic mock Docker log output for development without Docker."""
        mock_lines = [
            ("INFO  [backend] Starting FastAPI application...", LogLevel.INFO),
            ("INFO  [backend] Connecting to PostgreSQL at 127.0.0.1:5432", LogLevel.INFO),
            ("INFO  [backend] Connection pool established", LogLevel.INFO),
            ("INFO  [backend] Uvicorn running on http://0.0.0.0:8000", LogLevel.INFO),
            ("INFO  [frontend] Next.js starting...", LogLevel.INFO),
            ("INFO  [frontend] ✓ Ready on http://localhost:3000", LogLevel.INFO),
            ("WARN  [backend] Slow query detected: 2300ms", LogLevel.WARN),
            ("INFO  [postgres] checkpoint starting: time", LogLevel.INFO),
            ("ERROR [backend] Connection to Redis refused", LogLevel.ERROR),
            ("ERROR [backend]   ConnectionRefusedError: [Errno 111] Connection refused", LogLevel.ERROR),
            ("ERROR [backend]   at redis.client.Redis._send_command_parse_response", LogLevel.ERROR),
            ("INFO  [backend] Falling back to in-memory cache", LogLevel.INFO),
        ]
        for msg, level in mock_lines:
            await asyncio.sleep(0.6)
            await self._detector.feed_line(msg)
            event_type = EventType.STACKTRACE if level == LogLevel.ERROR else EventType.OUTPUT
            await self._broadcast(msg, level, event_type)

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        self.status = "STOPPED"
        await self._broadcast(f"■ Disconnected from container: {self.container_id}", LogLevel.INFO, EventType.CONTAINER_STOPPED)


class DockerTerminalManager:
    """Registry of active Docker container monitoring sessions."""

    def __init__(self) -> None:
        self._sessions: Dict[str, DockerSession] = {}

    def list_containers(self) -> List[Dict[str, Any]]:
        """List all available Docker containers."""
        if not docker_wrapper.is_available():
            return [
                {"id": "backend_c1", "name": "ai-devops-backend", "status": "running", "image": "python:3.12-slim", "ports": "8000"},
                {"id": "postgres_c2", "name": "ai-devops-postgres", "status": "running", "image": "postgres:15", "ports": "5432"},
                {"id": "redis_c3", "name": "ai-devops-redis", "status": "running", "image": "redis:7-alpine", "ports": "6379"},
                {"id": "frontend_c4", "name": "ai-devops-frontend", "status": "exited", "image": "node:20-alpine", "ports": "3000"},
            ]
        try:
            client = docker_wrapper.get_client()
            containers = client.containers.list(all=True)
            result = []
            for c in containers:
                ports = ", ".join(
                    str(p) for p in (c.ports or {}).keys()
                ) or "N/A"
                result.append({
                    "id": c.short_id,
                    "name": c.name,
                    "status": c.status,
                    "image": c.image.tags[0] if c.image.tags else c.image.short_id,
                    "ports": ports,
                    "exit_code": c.attrs.get("State", {}).get("ExitCode", 0),
                })
            return result
        except Exception as exc:
            logger.warning(f"[DockerTerminal] Failed to list containers: {exc}")
            return []

    def create_session(self, container_id: str, user_id: int, container_name: str = "") -> DockerSession:
        session_id = "docker_" + str(uuid.uuid4())[:8]
        session = DockerSession(session_id, container_id, container_name or container_id, user_id)
        self._sessions[session_id] = session
        return session

    def find_session_by_container(self, container_id: str) -> Optional[DockerSession]:
        """Return an active streaming session for the given container, or None."""
        for s in self._sessions.values():
            if s.container_id == container_id and s.status == "STREAMING":
                return s
        return None

    async def start_session(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session:
            await session.start()

    async def stop_session(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session:
            await session.stop()

    def get_session(self, session_id: str) -> Optional[DockerSession]:
        return self._sessions.get(session_id)


# Global singleton
docker_terminal_manager = DockerTerminalManager()
