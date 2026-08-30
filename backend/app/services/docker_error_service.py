"""
Docker Monitor service — error persistence + AI summary storage + deduplication.
100% standalone: no GitHub, no incidents, no repositories.
"""
from __future__ import annotations
import hashlib
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.docker_error import DockerAISummary, DockerError
from app.terminal.event import AIErrorSummary, NormalizedError

logger = logging.getLogger(__name__)

# Same error from same container within this window → treated as duplicate
DEDUP_WINDOW_MINUTES = 5


# ── Fingerprinting ─────────────────────────────────────────────────────────────

def _fingerprint(error: NormalizedError) -> str:
    """
    Build a short fingerprint for deduplication.
    Same error type + message start + location = same fingerprint.
    """
    parts = "|".join([
        error.error_type or "unknown",
        error.error_message[:120],
        error.file_path or "",
        str(error.line_number or ""),
    ])
    return hashlib.sha256(parts.encode()).hexdigest()[:16]


# ── Persistence helpers ────────────────────────────────────────────────────────

async def save_docker_error(
    error: NormalizedError,
    container_id: str,
    container_name: str,
) -> bool:
    """
    Persist a NormalizedError to the docker_errors table.
    Returns True if saved, False if a duplicate was found within DEDUP_WINDOW_MINUTES.
    """
    fingerprint = _fingerprint(error)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=DEDUP_WINDOW_MINUTES)

    async with AsyncSessionLocal() as db:
        # Deduplication check
        dup_result = await db.execute(
            select(DockerError)
            .where(DockerError.error_hash == fingerprint)
            .where(DockerError.container_id == container_id)
            .where(DockerError.created_at >= cutoff)
            .limit(1)
        )
        if dup_result.scalar_one_or_none():
            logger.debug(f"[DockerService] Skipping duplicate error {fingerprint} for {container_id}")
            return False

        db.add(DockerError(
            id=error.id,
            session_id=error.session_id,
            container_id=container_id,
            container_name=container_name,
            error_hash=fingerprint,
            language=error.language,
            error_type=error.error_type,
            error_message=error.error_message,
            file_path=error.file_path,
            line_number=error.line_number,
            raw_stack_trace=error.raw_stack_trace,
            severity=error.severity,
        ))
        await db.commit()
        logger.info(f"[DockerService] Saved error {error.id} | {error.error_type} | {container_name}")
        return True


async def save_docker_ai_summary(summary: AIErrorSummary) -> None:
    """Persist AI error summary to docker_ai_summaries table."""
    async with AsyncSessionLocal() as db:
        # Upsert: delete existing if re-analyzing
        existing = await db.get(DockerAISummary, summary.error_id)
        if existing:
            await db.delete(existing)

        db.add(DockerAISummary(
            error_id=summary.error_id,
            title=summary.title,
            what_happened=summary.what_happened,
            why_it_happened=summary.why_it_happened,
            recommended_fix=summary.recommended_fix,
            severity=summary.severity,
            confidence=summary.confidence,
            suggested_commands=json.dumps(summary.suggested_commands),
        ))
        await db.commit()
        logger.info(f"[DockerService] Saved AI summary for error {summary.error_id}")


# ── Query helpers ──────────────────────────────────────────────────────────────

async def get_docker_errors(
    container_id: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """
    Paginated list of Docker errors joined with AI summaries.
    Used by GET /api/v1/docker/errors.
    """
    async with AsyncSessionLocal() as db:
        query = (
            select(DockerError, DockerAISummary)
            .outerjoin(DockerAISummary, DockerError.id == DockerAISummary.error_id)
        )
        if container_id:
            query = query.where(DockerError.container_id == container_id)
        if severity:
            query = query.where(DockerError.severity == severity.upper())

        query = (
            query
            .order_by(DockerError.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = (await db.execute(query)).all()

        result = []
        for row in rows:
            err = row.DockerError
            summ = row.DockerAISummary
            result.append({
                "error": {
                    "id":              err.id,
                    "session_id":      err.session_id,
                    "container_id":    err.container_id,
                    "container_name":  err.container_name,
                    "language":        err.language,
                    "error_type":      err.error_type,
                    "error_message":   err.error_message,
                    "file_path":       err.file_path,
                    "line_number":     err.line_number,
                    "raw_stack_trace": err.raw_stack_trace,
                    "severity":        err.severity,
                    "created_at":      err.created_at.isoformat() if err.created_at else None,
                },
                "summary": {
                    "error_id":          summ.error_id,
                    "title":             summ.title,
                    "what_happened":     summ.what_happened,
                    "why_it_happened":   summ.why_it_happened,
                    "recommended_fix":   summ.recommended_fix,
                    "severity":          summ.severity,
                    "confidence":        summ.confidence,
                    "suggested_commands": json.loads(summ.suggested_commands or "[]"),
                    "created_at":        summ.created_at.isoformat() if summ.created_at else None,
                } if summ else None,
            })
        return result
