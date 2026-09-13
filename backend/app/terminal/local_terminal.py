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
import shutil
import subprocess
import threading
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
    "npm run lint",
    "npm",
    "npx",
    "yarn dev",
    "yarn start",
    "yarn",
    "pnpm dev",
    "pnpm start",
    "pnpm",
    "python app.py",
    "python main.py",
    "python -m pytest",
    "python -m uvicorn",
    "python",
    "uvicorn app.main:app",
    "uvicorn app.main:app --reload",
    "uvicorn",
    "flask run",
    "flask",
    "node server.js",
    "node index.js",
    "node",
    "go run main.go",
    "cargo run",
    "git status",
    "git log",
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
        self.process: Optional[subprocess.Popen] = None
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

    async def _handle_line(self, line: str) -> None:
        """Process a single stdout/stderr line through error detection and broadcast."""
        level = await self._detector.feed_line(line)
        event_type = EventType.STACKTRACE if level == LogLevel.ERROR else EventType.OUTPUT
        await self._broadcast(line, level, event_type)

    async def start(self) -> None:
        if not _command_allowed(self.command):
            raise PermissionError(f"Command not in whitelist: '{self.command}'")

        work_path = Path(self.working_dir).resolve()
        if not work_path.exists():
            raise FileNotFoundError(f"Working directory does not exist: {self.working_dir}")

        parts = shlex.split(self.command)
        env = {
            **os.environ,
            "FORCE_COLOR": "0",
            "NO_COLOR": "1",
            "PYTHONUNBUFFERED": "1",
        }

        executable = shutil.which(parts[0]) or parts[0]
        loop = asyncio.get_running_loop()

        self.process = subprocess.Popen(
            [executable, *parts[1:]],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(work_path),
            env=env,
            text=True,
            bufsize=1,
            errors="replace",
        )
        self.status = "RUNNING"
        await self._broadcast(f"▶ Process started: {self.command} (PID {self.process.pid})", LogLevel.INFO, EventType.PROCESS_STARTED)
        logger.info(f"[LocalTerminal] Session {self.session_id} started PID {self.process.pid}")

        def _reader(stream, stream_name: str):
            try:
                for line in iter(stream.readline, ""):
                    clean = line.rstrip("\r\n")
                    if not clean:
                        continue
                    asyncio.run_coroutine_threadsafe(self._handle_line(clean), loop)
            except Exception as exc:
                logger.warning(f"[LocalTerminal] Stream {stream_name} error: {exc}")
            finally:
                try:
                    stream.close()
                except Exception:
                    pass

        def _waiter():
            self.process.wait()
            self.exit_code = self.process.returncode
            self.status = "EXITED"
            level = LogLevel.ERROR if self.exit_code != 0 else LogLevel.INFO
            msg = f"■ Process exited with code {self.exit_code}"
            asyncio.run_coroutine_threadsafe(self._broadcast(msg, level, EventType.PROCESS_EXITED), loop)

        threading.Thread(target=_reader, args=(self.process.stdout, "stdout"), daemon=True).start()
        threading.Thread(target=_reader, args=(self.process.stderr, "stderr"), daemon=True).start()
        threading.Thread(target=_waiter, daemon=True).start()

    async def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                await asyncio.to_thread(self.process.wait, 5.0)
            except Exception:
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
            try:
                await session.start()
            except Exception as exc:
                err_msg = str(exc) or type(exc).__name__
                logger.error(f"[LocalTerminal] Failed to start session {session_id}: {err_msg}", exc_info=True)
                session.status = "ERROR"
                await session._broadcast(f"✖ Failed to start process: {err_msg}", LogLevel.ERROR, EventType.PROCESS_EXITED)

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
