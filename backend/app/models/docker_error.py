"""
Docker Monitor — database models.
Completely standalone from GitHub/incident/repository models.
"""
from __future__ import annotations
from sqlalchemy import Column, String, Float, Integer, Text, DateTime, Index
from sqlalchemy.sql import func
from app.core.database import Base


class DockerError(Base):
    """Persisted terminal error detected from a Docker container log stream."""

    __tablename__ = "docker_errors"
    __table_args__ = (
        Index("ix_docker_errors_container_created", "container_id", "created_at"),
        Index("ix_docker_errors_hash_container", "error_hash", "container_id"),
    )

    id              = Column(String,  primary_key=True)          # NormalizedError.id
    session_id      = Column(String,  nullable=False, index=True)
    container_id    = Column(String,  nullable=False, index=True)
    container_name  = Column(String,  nullable=True)
    error_hash      = Column(String,  nullable=False)            # SHA-256 fingerprint for dedup
    language        = Column(String,  nullable=True)             # python | javascript | go | …
    error_type      = Column(String,  nullable=True)             # TypeError | ValueError | …
    error_message   = Column(Text,    nullable=False, default="")
    file_path       = Column(String,  nullable=True)
    line_number     = Column(Integer, nullable=True)
    raw_stack_trace = Column(Text,    nullable=False, default="")
    severity        = Column(String,  nullable=False, default="ERROR")
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class DockerAISummary(Base):
    """AI-generated analysis for a DockerError. One-to-one with DockerError."""

    __tablename__ = "docker_ai_summaries"

    error_id           = Column(String, primary_key=True)        # FK → docker_errors.id
    title              = Column(String, nullable=False, default="")
    what_happened      = Column(Text,   nullable=False, default="")
    why_it_happened    = Column(Text,   nullable=False, default="")
    recommended_fix    = Column(Text,   nullable=False, default="")
    severity           = Column(String, nullable=False, default="HIGH")
    confidence         = Column(Float,  nullable=False, default=0.0)
    suggested_commands = Column(Text,   nullable=False, default="[]")   # JSON array
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
