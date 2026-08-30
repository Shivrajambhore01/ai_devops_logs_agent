"""
Unified terminal event schema and event type enums.
All messages flowing through WebSocket use this structure.
"""
from __future__ import annotations
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field
import uuid


class EventType(str, Enum):
    OUTPUT            = "OUTPUT"
    INFO              = "INFO"
    WARN              = "WARN"
    ERROR             = "ERROR"
    STACKTRACE        = "STACKTRACE"
    ERROR_DETECTED    = "ERROR_DETECTED"
    PROCESS_STARTED   = "PROCESS_STARTED"
    PROCESS_EXITED    = "PROCESS_EXITED"
    CONTAINER_STARTED = "CONTAINER_STARTED"
    CONTAINER_STOPPED = "CONTAINER_STOPPED"
    AI_ANALYSIS_STARTED   = "AI_ANALYSIS_STARTED"
    AI_ANALYSIS_COMPLETED = "AI_ANALYSIS_COMPLETED"
    SESSION_CLOSED    = "SESSION_CLOSED"
    HEARTBEAT         = "HEARTBEAT"


class LogLevel(str, Enum):
    INFO  = "INFO"
    WARN  = "WARN"
    ERROR = "ERROR"
    AI    = "AI"
    DEBUG = "DEBUG"


class TerminalEvent(BaseModel):
    """Single structured terminal event broadcast over WebSocket."""
    id:          str       = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    session_id:  str
    timestamp:   str       = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    source:      str       = "local"          # "local" | "docker"
    container:   Optional[str] = None
    stream:      str       = "stdout"         # "stdout" | "stderr"
    level:       LogLevel  = LogLevel.INFO
    message:     str
    event_type:  EventType = EventType.OUTPUT
    metadata:    Dict[str, Any] = Field(default_factory=dict)

    def to_json(self) -> Dict[str, Any]:
        return self.model_dump()


class NormalizedError(BaseModel):
    """Parsed & normalized error ready for AI analysis."""
    id:            str = Field(default_factory=lambda: "err_" + str(uuid.uuid4())[:8])
    session_id:    str
    language:      Optional[str] = None       # "python" | "javascript" | "go" ...
    error_type:    Optional[str] = None       # "ModuleNotFoundError" | "TypeError"
    error_message: str = ""
    file_path:     Optional[str] = None
    line_number:   Optional[int] = None
    raw_stack_trace: str = ""
    severity:      str = "ERROR"
    timestamp:     str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AIErrorSummary(BaseModel):
    """Structured AI-generated error explanation and fix recommendation."""
    error_id:          str
    session_id:        str
    title:             str
    what_happened:     str
    why_it_happened:   str
    recommended_fix:   str
    severity:          str = "HIGH"
    confidence:        float = 0.0
    suggested_commands: list[str] = Field(default_factory=list)
    timestamp:         str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
