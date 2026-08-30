"""
Background AI Worker for Decoupled Error Intelligence.
Consumes error payloads from Redis queue ('ai_error_jobs'),
executes Qwen2.5-Coder LLM inference asynchronously,
persists diagnoses to PostgreSQL, and broadcasts WebSocket UI events.
"""
from __future__ import annotations
import asyncio
import logging
from typing import Any, Dict, Optional

from app.terminal.event import AIErrorSummary, EventType, LogLevel, NormalizedError, TerminalEvent
from app.terminal.websocket_manager import ws_manager
from app.services.queue_service import dequeue_error_job

logger = logging.getLogger(__name__)

_worker_task: Optional[asyncio.Task] = None
_running: bool = False


async def process_single_error_job(job: Dict[str, Any]) -> None:
    """
    Process one error job:
    1. Parse payload into NormalizedError
    2. Notify UI: AI_ANALYSIS_STARTED
    3. Call Qwen2.5-Coder LLM
    4. Save to PostgreSQL (docker_errors & docker_ai_summaries)
    5. Notify UI: AI_ANALYSIS_COMPLETED
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

    # 1. Notify frontend UI over WebSocket that AI analysis has started
    await ws_manager.broadcast(
        session_id,
        TerminalEvent(
            session_id=session_id,
            level=LogLevel.AI,
            message="🤖 AI Worker started Qwen2.5-Coder diagnosis...",
            event_type=EventType.AI_ANALYSIS_STARTED,
        ),
    )

    # 2. Execute Expert Diagnosis or LLM Inference
    from app.ai.error_analyzer import _expert_rule_diagnosis, _call_llm, _fallback_summary
    expert_summary = _expert_rule_diagnosis(normalized, session_id)
    if expert_summary and expert_summary.confidence >= 0.94:
        summary = expert_summary
    else:
        try:
            summary = await _call_llm(normalized, session_id)
        except Exception as exc:
            logger.warning(f"[AIWorker] LLM inference fallback for {error_id}: {exc}")
            summary = expert_summary or _fallback_summary(normalized, session_id)

    # 3. Save error & AI summary to PostgreSQL DB
    try:
        from app.services.docker_error_service import save_docker_error, save_docker_ai_summary
        await save_docker_error(normalized, container_id, container_name)
        await save_docker_ai_summary(summary)
    except Exception as exc:
        logger.warning(f"[AIWorker] Database persistence warning: {exc}")

    # 4. Broadcast AI_ANALYSIS_COMPLETED event to Frontend Web Dashboard
    await ws_manager.broadcast_raw(
        session_id,
        {
            "event_type": EventType.AI_ANALYSIS_COMPLETED,
            "session_id": session_id,
            "level": "AI",
            "ai_summary": summary.model_dump(),
        },
    )
    logger.info(f"[AIWorker] Diagnosis complete for error {error_id}: {summary.title}")


async def ai_worker_loop() -> None:
    """
    Continuous background loop consuming error jobs from Redis queue.
    Runs forever until cancelled.
    """
    global _running
    _running = True
    logger.info("[AIWorker] Background Qwen2.5-Coder AI Worker loop started")

    while _running:
        try:
            job = await dequeue_error_job(timeout=1.5)
            if job:
                logger.info(f"[AIWorker] Picked up job {job.get('error_id')} from queue")
                await process_single_error_job(job)
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
