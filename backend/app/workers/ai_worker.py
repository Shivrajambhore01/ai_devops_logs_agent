"""
Background AI Worker for Decoupled Error Intelligence.
Consumes error payloads from Redis Streams ('docker_ai_error_stream'),
executes hierarchical error diagnosis (Cache -> Rules -> LLM),
persists diagnoses to PostgreSQL, and broadcasts WebSocket UI events.
"""
from __future__ import annotations
import asyncio
import hashlib
import logging
from typing import Any, Dict, Optional

from app.terminal.event import AIErrorSummary, EventType, LogLevel, NormalizedError, TerminalEvent
from app.terminal.websocket_manager import ws_manager
from app.services.queue_service import (
    dequeue_error_job,
    ack_error_job,
    get_cached_ai_analysis,
    cache_ai_analysis,
)

logger = logging.getLogger(__name__)

_worker_task: Optional[asyncio.Task] = None
_running: bool = False
WORKER_CONSUMER_NAME = "ai-worker-pool-1"


def _compute_fingerprint(error: NormalizedError) -> str:
    parts = f"{error.error_type or 'unknown'}|{(error.error_message or '')[:100]}|{error.file_path or ''}"
    return hashlib.sha256(parts.encode()).hexdigest()[:16]


async def process_single_error_job(msg_id: str, job: Dict[str, Any]) -> None:
    """
    Process one error job:
    1. Parse payload into NormalizedError
    2. Check 24-hour Redis AI Result Cache (Instant HIT)
    3. If Cache Miss -> Tier 1 Expert Rules -> Tier 2 LLM
    4. Save to Redis Cache (24h TTL)
    5. Save to PostgreSQL (docker_errors & docker_ai_summaries)
    6. Broadcast AI_ANALYSIS_COMPLETED over WebSocket
    7. Acknowledge stream message (XACK)
    """
    session_id = job.get("session_id", "manual")
    error_id = job.get("error_id", "err_unknown")
    container_id = job.get("container_id", "unknown")
    container_name = job.get("container_name", "container")

    normalized = NormalizedError(
        id=error_id,
        session_id=session_id,
        language=job.get("language"),
        error_type=job.get("error_type"),
        error_message=job.get("error_message", ""),
        file_path=job.get("file_path"),
        line_number=job.get("line_number"),
        raw_stack_trace=job.get("raw_stack_trace", ""),
        severity=job.get("severity", "ERROR"),
    )

    fingerprint = _compute_fingerprint(normalized)

    # 1. Notify frontend UI over WebSocket that AI analysis has started
    await ws_manager.broadcast(
        session_id,
        TerminalEvent(
            session_id=session_id,
            level=LogLevel.AI,
            message="🤖 AI Worker analyzing diagnosis...",
            event_type=EventType.AI_ANALYSIS_STARTED,
        ),
    )

    # 2. Hierarchical Level 2: Check 24-hour AI Result Cache (< 1ms)
    cached_data = await get_cached_ai_analysis(fingerprint)
    if cached_data:
        summary = AIErrorSummary(
            error_id=error_id,
            session_id=session_id,
            title=cached_data.get("title", "Diagnosed Error"),
            what_happened=cached_data.get("what_happened", ""),
            why_it_happened=cached_data.get("why_it_happened", ""),
            recommended_fix=cached_data.get("recommended_fix", ""),
            severity=cached_data.get("severity", normalized.severity),
            confidence=float(cached_data.get("confidence", 0.95)),
            suggested_commands=cached_data.get("suggested_commands", []),
        )
        logger.info(f"[AIWorker] Instant cache hit for {error_id} ({fingerprint}): {summary.title}")
    else:
        # 3. Hierarchical Level 1: Deterministic Expert SRE Rule Engine (< 2ms)
        from app.ai.error_analyzer import _expert_rule_diagnosis, _call_llm, _fallback_summary
        expert_summary = _expert_rule_diagnosis(normalized, session_id)
        if expert_summary and expert_summary.confidence >= 0.94:
            summary = expert_summary
        else:
            # 4. Hierarchical Level 3/4: LLM Inference
            try:
                summary = await _call_llm(normalized, session_id)
            except Exception as exc:
                logger.warning(f"[AIWorker] LLM inference fallback for {error_id}: {exc}")
                summary = expert_summary or _fallback_summary(normalized, session_id)

        # Cache newly generated diagnosis in Redis for 24 hours
        await cache_ai_analysis(fingerprint, summary.model_dump())

    # 5. Persist error and AI summary to PostgreSQL
    try:
        from app.services.docker_error_service import save_docker_error, save_docker_ai_summary
        await save_docker_error(normalized, container_id, container_name)
        await save_docker_ai_summary(summary)
    except Exception as exc:
        logger.warning(f"[AIWorker] Database persistence warning: {exc}")

    # 6. Broadcast AI_ANALYSIS_COMPLETED event to Frontend Dashboard
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

    # 7. Acknowledge stream message
    await ack_error_job(msg_id)
    logger.info(f"[AIWorker] Diagnosis complete and acknowledged for {error_id}: {summary.title}")


async def ai_worker_loop() -> None:
    """Continuous background worker loop consuming error jobs from Redis Streams."""
    global _running
    _running = True
    logger.info(f"[AIWorker] Background AI Worker loop started as consumer '{WORKER_CONSUMER_NAME}'")

    while _running:
        try:
            item = await dequeue_error_job(consumer_name=WORKER_CONSUMER_NAME, timeout=1.5)
            if item:
                msg_id, job = item
                logger.info(f"[AIWorker] Picked up job {job.get('error_id')} (stream_id: {msg_id})")
                await process_single_error_job(msg_id, job)
        except asyncio.CancelledError:
            logger.info("[AIWorker] Worker loop cancellation requested")
            break
        except Exception as exc:
            logger.error(f"[AIWorker] Error in worker loop: {exc}")
            await asyncio.sleep(1.0)

    _running = False
    logger.info("[AIWorker] Worker loop stopped")


def start_ai_worker() -> asyncio.Task:
    """Launch background worker task on startup."""
    global _worker_task
    if _worker_task is None or _worker_task.done():
        loop = asyncio.get_event_loop()
        _worker_task = loop.create_task(ai_worker_loop())
        logger.info("[AIWorker] Launched background worker task")
    return _worker_task


def stop_ai_worker() -> None:
    """Stop background worker task on shutdown."""
    global _worker_task, _running
    _running = False
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        _worker_task = None
