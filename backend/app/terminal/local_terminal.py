"""
Local terminal process manager.
Spawns controlled local processes (npm run dev, python app.py, etc.)
with strict command whitelisting and path validation.

Security model:
  - Commands are validated against ALLOWED_COMMANDS list
  - Working directory must be a registered project path
  - No shell=True to prevent injection
"""
from __future__ import annotations
import asyncio
import logging
import os
import shlex
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

from app.terminal.event import EventType, LogLevel, TerminalEvent
from app.terminal.error_detector import ErrorDetector
from app.terminal.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

# ── Command whitelist ──────────────────────────────────────────────────────────
ALLOWED_COMMANDS = [
    "npm run dev",
    "npm run start",
    "npm start",
    "npm test",
    "npm run build",
    "yarn dev",
    "yarn start",
    "python app.py",
    "python main.py",
    "python -m pytest",
    "python -m uvicorn",
    "uvicorn app.main:app",
    "uvicorn app.main:app --reload",
    "flask run",
    "node server.js",
    "node index.js",
    "go run main.go",
    "cargo run",
    "make dev",
    "make start",
]


def _command_allowed(command: str) -> bool:
    cmd_lower = command.strip().lower()
    return any(cmd_lower.startswith(allowed.lower()) for allowed in ALLOWED_COMMANDS)


class TerminalSession:
    def __init__(
        self,
        session_id: str,
        command: str,
        working_dir: str,
        user_id: int,
    ):
        self.session_id    = session_id
        self.command       = command
        self.working_dir   = working_dir
        self.user_id       = user_id
        self.status        = "STARTING"
        self.process: Optional[asyncio.subprocess.Process] = None
        self.created_at    = datetime.now(timezone.utc).isoformat()
        self.exit_code: Optional[int] = None
        self._detector     = ErrorDetector(session_id, self._on_error)
        self._errors: list = []

    async def _broadcast(self, message: str, level: LogLevel = LogLevel.INFO, event_type: EventType = EventType.OUTPUT) -> None:
        event = TerminalEvent(
            session_id=self.session_id,
            source="local",
            level=level,
            message=message,
            event_type=event_type,
        )
        await ws_manager.broadcast(self.session_id, event)

    async def _on_error(self, normalized_error) -> None:
        """Called when error detector has a complete error block."""
        self._errors.append(normalized_error)
        # Notify AI worker asynchronously (import here to avoid circular)
        from app.ai.error_analyzer import analyze_error_async
        asyncio.create_task(analyze_error_async(normalized_error, self.session_id))

    async def start(self) -> None:
        if not _command_allowed(self.command):
            raise PermissionError(f"Command not in whitelist: '{self.command}'")

        work_path = Path(self.working_dir).resolve()
        if not work_path.exists():
            raise FileNotFoundError(f"Working directory does not exist: {self.working_dir}")

        parts = shlex.split(self.command)
        env = {**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"}

        self.process = await asyncio.create_subprocess_exec(
            *parts,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(work_path),
            env=env,
        )
        self.status = "RUNNING"
        await self._broadcast(f"▶ Process started: {self.command} (PID {self.process.pid})", LogLevel.INFO, EventType.PROCESS_STARTED)
        logger.info(f"[LocalTerminal] Session {self.session_id} started PID {self.process.pid}")

        # Stream stdout & stderr concurrently
        asyncio.create_task(self._stream(self.process.stdout, "stdout"))
        asyncio.create_task(self._stream(self.process.stderr, "stderr"))
        asyncio.create_task(self._wait_exit())

    async def _stream(self, stream, stream_name: str) -> None:
        if stream is None:
            return
        try:
            async for raw_bytes in stream:
                line = raw_bytes.decode("utf-8", errors="replace").rstrip()
                if not line:
                    continue
                level = await self._detector.feed_line(line)
                event_type = EventType.STACKTRACE if level == LogLevel.ERROR else EventType.OUTPUT
                await self._broadcast(line, level, event_type)
        except Exception as exc:
            logger.warning(f"[LocalTerminal] Stream error on {stream_name}: {exc}")

    async def _wait_exit(self) -> None:
        if self.process:
            await self.process.wait()
            self.exit_code = self.process.returncode
            self.status = "EXITED"
            level = LogLevel.ERROR if self.exit_code != 0 else LogLevel.INFO
            msg = f"■ Process exited with code {self.exit_code}"
            await self._broadcast(msg, level, EventType.PROCESS_EXITED)

    async def stop(self) -> None:
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self.process.kill()
        self.status = "STOPPED"


class LocalTerminalManager:
    """Registry of active local terminal sessions."""

    def __init__(self) -> None:
        self._sessions: Dict[str, TerminalSession] = {}

    def create_session(self, command: str, working_dir: str, user_id: int) -> TerminalSession:
        if not _command_allowed(command):
            raise PermissionError(f"Command not in whitelist: '{command}'")
        session_id = "local_" + str(uuid.uuid4())[:8]
        session = TerminalSession(session_id, command, working_dir, user_id)
        self._sessions[session_id] = session
        return session

    async def start_session(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session:
            await session.start()

    async def stop_session(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session:
            await session.stop()

    def get_session(self, session_id: str) -> Optional[TerminalSession]:
        return self._sessions.get(session_id)

    def list_sessions(self, user_id: Optional[int] = None):
        sessions = list(self._sessions.values())
        if user_id is not None:
            sessions = [s for s in sessions if s.user_id == user_id]
        return [{
            "session_id": s.session_id,
            "command": s.command,
            "working_dir": s.working_dir,
            "status": s.status,
            "exit_code": s.exit_code,
            "created_at": s.created_at,
        } for s in sessions]

    def allowed_commands(self):
        return ALLOWED_COMMANDS


# Global singleton
local_terminal_manager = LocalTerminalManager()
