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
    before: Optional[str] = None,
    hours: Optional[float] = None,
    since: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Keyset / cursor-paginated list of Docker errors joined with AI summaries.
    Uses 'before' ISO timestamp cursor for O(1) performance on large datasets.
    Supports time filtering by 'hours' (e.g. 1.0 for last 1 hour) or 'since' ISO timestamp.
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

        # Time-based filtering (e.g., last 1 hour)
        if hours is not None and hours > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
            query = query.where(DockerError.created_at >= cutoff)
        elif since:
            try:
                since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
                query = query.where(DockerError.created_at >= since_dt)
            except Exception:
                pass

        # Keyset cursor pagination
        if before:
            try:
                before_dt = datetime.fromisoformat(before.replace("Z", "+00:00"))
                query = query.where(DockerError.created_at < before_dt)
            except Exception:
                pass
        elif offset > 0:
            query = query.offset(offset)

        query = query.order_by(DockerError.created_at.desc()).limit(limit)
        rows = (await db.execute(query)).all()

        result = []
        for row in rows:
            err = row.DockerError
            summ = row.DockerAISummary
            err_created = None
            if err.created_at:
                err_created = (
                    err.created_at.replace(tzinfo=timezone.utc).isoformat()
                    if err.created_at.tzinfo is None
                    else err.created_at.isoformat()
                )
            summ_created = None
            if summ and summ.created_at:
                summ_created = (
                    summ.created_at.replace(tzinfo=timezone.utc).isoformat()
                    if summ.created_at.tzinfo is None
                    else summ.created_at.isoformat()
                )
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
                    "created_at":      err_created,
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
                    "created_at":        summ_created,
                } if summ else None,
            })
        return result


async def purge_expired_docker_errors(retention_days: int = 14) -> int:
    """
    Automatic Database Retention:
    Deletes raw Docker errors older than retention_days (default 14 days)
    to keep PostgreSQL lightweight and indexes compact.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    async with AsyncSessionLocal() as db:
        # Find old error IDs
        res = await db.execute(
            select(DockerError.id).where(DockerError.created_at < cutoff)
        )
        old_ids = res.scalars().all()
        if not old_ids:
            return 0

        # Delete AI summaries first
        for err_id in old_ids:
            summ = await db.get(DockerAISummary, err_id)
            if summ:
                await db.delete(summ)
            err = await db.get(DockerError, err_id)
            if err:
                await db.delete(err)

        await db.commit()
        logger.info(f"[DockerRetention] Purged {len(old_ids)} errors older than {retention_days} days")
        return len(old_ids)


async def clear_all_docker_errors() -> int:
    """Clear all errors and summaries from the database."""
    from sqlalchemy import delete
    async with AsyncSessionLocal() as db:
        await db.execute(delete(DockerAISummary))
        res = await db.execute(delete(DockerError))
        await db.commit()
        return res.rowcount or 0


async def reanalyze_docker_error(error_id: str) -> Optional[Dict[str, Any]]:
    """Re-analyze an existing error by ID using live AI analyzer and update DB & WebSockets."""
    from app.terminal.websocket_manager import ws_manager
    from app.terminal.event import EventType

    async with AsyncSessionLocal() as db:
        err = await db.get(DockerError, error_id)
        if not err:
            return None

        normalized = NormalizedError(
            id=err.id,
            session_id=err.session_id,
            language=err.language,
            error_type=err.error_type,
            error_message=err.error_message,
            file_path=err.file_path,
            line_number=err.line_number,
            raw_stack_trace=err.raw_stack_trace or err.error_message,
            severity=err.severity or "HIGH",
        )
        container_id = err.container_id
        container_name = err.container_name

    from app.ai.error_analyzer import _expert_rule_diagnosis, _call_llm, _fallback_summary
    session_id = normalized.session_id or "manual"
    expert_summary = _expert_rule_diagnosis(normalized, session_id)
    if expert_summary and expert_summary.confidence >= 0.96:
        summary = expert_summary
    else:
        try:
            summary = await _call_llm(normalized, session_id)
        except Exception as exc:
            logger.warning(f"[DockerService] LLM re-analysis fallback: {exc}")
            summary = expert_summary or _fallback_summary(normalized, session_id)

    # Save new summary to DB
    await save_docker_ai_summary(summary)

    # Broadcast updated summary over WebSocket
    summary_dict = summary.model_dump()
    summary_dict["container_id"] = container_id
    summary_dict["container_name"] = container_name

    await ws_manager.broadcast_raw(
        session_id,
        {
            "event_type": EventType.AI_ANALYSIS_COMPLETED,
            "session_id": session_id,
            "container_id": container_id,
            "container_name": container_name,
            "level": "AI",
            "ai_summary": summary_dict,
        },
    )
    return summary_dict


async def reanalyze_all_docker_errors(limit: int = 30) -> List[Dict[str, Any]]:
    """Re-analyze recent errors in database."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(DockerError.id).order_by(DockerError.created_at.desc()).limit(limit))
        error_ids = res.scalars().all()

    results = []
    for err_id in error_ids:
        try:
            summ = await reanalyze_docker_error(err_id)
            if summ:
                results.append(summ)
        except Exception as exc:
            logger.warning(f"[DockerService] Re-analyzing error {err_id} failed: {exc}")
    return results
