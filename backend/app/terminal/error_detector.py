"""
Error detector — consumes terminal lines and groups them into error events.
Does NOT call LLM. Pure deterministic pattern matching.
Maintains a rolling buffer to capture complete stack traces.
"""
from __future__ import annotations
import asyncio
import logging
import re
from collections import deque
from typing import Callable, Deque, List, Optional

from app.terminal.event import EventType, LogLevel, NormalizedError, TerminalEvent
from app.terminal.error_patterns import detect_level, is_stacktrace_start, extract_exit_code

logger = logging.getLogger(__name__)

BUFFER_MAX_LINES = 60      # Max lines to accumulate for a single error event
FLUSH_IDLE_SECS  = 0.35    # Fast flush buffer (350ms idle)


class ErrorDetector:
    """
    Stateful error detector for one terminal session.

    Usage:
        detector = ErrorDetector(session_id, on_error_callback)
        await detector.feed_line(raw_line)
    """

    def __init__(self, session_id: str, on_error: Callable[[NormalizedError], None]):
        self.session_id = session_id
        self._on_error  = on_error
        self._buffer:   Deque[str] = deque(maxlen=BUFFER_MAX_LINES)
        self._in_error: bool = False
        self._flush_task: Optional[asyncio.Task] = None

    async def feed_line(self, line: str) -> LogLevel:
        """
        Feed one line of terminal output.
        Returns detected LogLevel.
        """
        level = detect_level(line)
        is_trace = is_stacktrace_start(line)

        # 1. New error or stack trace start
        if level == "ERROR" or is_trace:
            self._buffer.append(line)
            self._in_error = True
            await self._reschedule_flush()
            return LogLevel.ERROR

        # 2. If currently capturing a multiline error/stacktrace
        if self._in_error:
            # Continuation lines in stack traces are indented or contain file/trace patterns
            is_continuation = (
                line.startswith((" ", "\t", "  "))
                or "File " in line
                or " at " in line
                or "Exception" in line
                or "Error" in line
                or not line.strip()
            )
            if is_continuation:
                self._buffer.append(line)
                await self._reschedule_flush()
                return LogLevel.ERROR
            else:
                # Normal unindented log line arrived (e.g. INFO / GET 200) -> stack trace has finished!
                await self._flush_error()

        # 3. Check for abnormal process exit
        exit_code = extract_exit_code(line)
        if exit_code is not None and exit_code != 0:
            self._buffer.append(line)
            await self._flush_error()
            return LogLevel.ERROR

        if level == "WARN":
            return LogLevel.WARN

        return LogLevel.INFO

    async def _reschedule_flush(self) -> None:
        if self._flush_task and not self._flush_task.done():
            self._flush_task.cancel()
        self._flush_task = asyncio.create_task(self._delayed_flush())

    async def _delayed_flush(self) -> None:
        try:
            await asyncio.sleep(FLUSH_IDLE_SECS)
            await self._flush_error()
        except asyncio.CancelledError:
            pass

    async def _flush_error(self) -> None:
        if self._flush_task and not self._flush_task.done():
            self._flush_task.cancel()
            self._flush_task = None

        if not self._buffer:
            self._in_error = False
            return

        raw = "\n".join(self._buffer)
        self._buffer.clear()
        self._in_error = False

        normalized = _normalize_error(raw, self.session_id)
        try:
            if asyncio.iscoroutinefunction(self._on_error):
                await self._on_error(normalized)
            else:
                self._on_error(normalized)
        except Exception as exc:
            logger.warning(f"[ErrorDetector] on_error callback raised: {exc}")


# ── Normalization helpers ──────────────────────────────────────────────────────

_PY_ERROR_RE         = re.compile(r'^([A-Za-z][A-Za-z0-9_.]*(?:Error|Exception|Warning)):\s*(.*)', re.M)
_JS_ERROR_RE         = re.compile(r'^([A-Za-z][A-Za-z0-9]*(?:Error|Exception)):\s*(.*)', re.M)
_INLINE_ERROR_RE     = re.compile(r'(?::\s*|\s+|^)([A-Za-z][A-Za-z0-9_.]*(?:Error|Exception|Warning|Fault|Panic)):\s*(.*)', re.M)
_FILE_LINE_RE        = re.compile(r'(?:File|file)\s+"?([^":\n]+)"?,?\s+line\s+(\d+)', re.M)
_AT_LINE_RE          = re.compile(r'at\s+[^\(]*\(?([^:\)\s]+):(\d+)(?::\d+)?\)?', re.M)
_FILE_COLON_LINE_RE  = re.compile(r'([a-zA-Z0-9_\-\.\/\\~]+\.(?:py|js|ts|tsx|jsx|go|rs|java|rb|php)):(\d+)', re.M)


def _detect_language(raw: str) -> Optional[str]:
    raw_lower = raw.lower()
    if "traceback (most recent call last)" in raw_lower or ".py" in raw_lower or "forkpoolworker" in raw_lower or "celery" in raw_lower:
        return "python"
    if "at object.<anonymous>" in raw_lower or "at module." in raw_lower or "npm err" in raw_lower or ".js" in raw_lower:
        return "javascript"
    if "goroutine" in raw_lower and "panic:" in raw_lower:
        return "go"
    if "at " in raw_lower and (".ts:" in raw_lower or ".tsx:" in raw_lower):
        return "typescript"
    return None


def _clean_error_message(msg: str) -> str:
    """Strip bracketed logging headers and timestamps from message strings."""
    cleaned = re.sub(r'^\[\d{4}-\d{2}-\d{2}[^\]]+\]\s*', '', msg).strip()
    cleaned = re.sub(r'^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\s]*\s*', '', cleaned).strip()
    cleaned = re.sub(r'^(?:ERROR|WARN|WARNING|CRITICAL|INFO|DEBUG):\s*', '', cleaned, flags=re.I).strip()
    return cleaned or msg


def _normalize_error(raw: str, session_id: str) -> NormalizedError:
    lang = _detect_language(raw)
    error_type = None
    error_msg  = ""
    file_path  = None
    line_num   = None

    # 1. First look for standard start-of-line tracebacks
    for pattern in [_PY_ERROR_RE, _JS_ERROR_RE]:
        matches = pattern.findall(raw)
        if matches:
            error_type, error_msg = matches[-1]
            error_msg = error_msg.strip()
            break

    # 2. If no start-of-line match, look for inline error headers (e.g. Celery / Uvicorn logs)
    if not error_type:
        inline_matches = _INLINE_ERROR_RE.findall(raw)
        if inline_matches:
            # Prefer last error/warning match
            error_type, error_msg = inline_matches[-1]
            error_msg = error_msg.strip()

    # 3. Extract file and line from File "...", line X or path.ext:line
    file_matches = _FILE_LINE_RE.findall(raw) or _AT_LINE_RE.findall(raw) or _FILE_COLON_LINE_RE.findall(raw)
    if file_matches:
        file_path, l_str = file_matches[-1]
        try:
            line_num = int(l_str)
        except ValueError:
            pass

    # 4. Clean error message
    if error_msg:
        error_msg = _clean_error_message(error_msg)

    # 5. Fallback if message is still empty
    if not error_msg:
        first_error_line = next(
            (l for l in raw.splitlines() if detect_level(l) == "ERROR"), raw.splitlines()[0]
        )
        error_msg = _clean_error_message(first_error_line.strip()[:300])

    if not error_type:
        if "500" in error_msg:
            error_type = "HTTP500InternalServerError"
        elif "Connection refused" in error_msg or "ECONNREFUSED" in error_msg:
            error_type = "ConnectionRefusedError"
        elif "sawarning" in raw.lower():
            error_type = "SAWarning"
        elif "OOMKilled" in raw or "137" in raw:
            error_type = "OutOfMemoryError"
        elif "keyerror" in raw.lower():
            error_type = "KeyError"
        elif "operationalerror" in raw.lower():
            error_type = "OperationalError"
        else:
            error_type = "RuntimeError"

    # Determine severity
    raw_lower = raw.lower()
    if any(k in raw_lower for k in ["oomkilled", "fatal", "panic:", "segmentation fault", "critical", "killed"]):
        severity = "CRITICAL"
    elif any(k in raw_lower for k in ["sawarning", "userwarning", "deprecationwarning"]) and not any(k in raw_lower for k in ["traceback", "fatal", "exception"]):
        severity = "MEDIUM"
    elif any(k in raw_lower for k in ["error", "exception", "traceback", "500"]):
        severity = "HIGH"
    else:
        severity = "MEDIUM"

    return NormalizedError(
        session_id=session_id,
        language=lang,
        error_type=error_type,
        error_message=error_msg,
        file_path=file_path,
        line_number=line_num,
        raw_stack_trace=raw,
        severity=severity,
    )
