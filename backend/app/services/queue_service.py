"""
Redis Queue Service for Decoupled AI Error Processing.
Provides fast async enqueuing into Redis list 'ai_error_jobs'
and Redis-based fingerprint deduplication (5-minute TTL).
Includes zero-delay in-memory queue fallback if Redis server is unreachable.
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
QUEUE_KEY = "ai_error_jobs"
DEDUP_PREFIX = "error_dedup:"
DEDUP_TTL_SECONDS = 300  # 5 minutes

# In-memory fallback queue if Redis connection fails
_in_memory_queue: asyncio.Queue = asyncio.Queue()
_in_memory_dedup: Dict[str, float] = {}

_redis_client: Optional[Any] = None
_last_redis_attempt: float = 0.0
_redis_retry_interval: float = 30.0  # Cooldown before retrying Redis
_redis_offline_logged: bool = False


async def get_redis_client() -> Optional[Any]:
    """Lazy initialize redis.asyncio client with cooldown backoff when offline."""
    global _redis_client, _last_redis_attempt, _redis_offline_logged
    if _redis_client is not None:
        return _redis_client

    now = time.time()
    if now - _last_redis_attempt < _redis_retry_interval:
        return None

    _last_redis_attempt = now
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=0.5)
        await asyncio.wait_for(client.ping(), timeout=0.5)
        _redis_client = client
        _redis_offline_logged = False
        logger.info(f"[RedisQueue] Connected to Redis at {REDIS_URL}")
        return _redis_client
    except Exception as exc:
        if not _redis_offline_logged:
            logger.info(f"[RedisQueue] Redis server not available. Running high-performance in-memory queue.")
            _redis_offline_logged = True
        _redis_client = None
        return None


async def is_error_duplicate(error_hash: str, container_id: str) -> bool:
    """
    Check if this error fingerprint was seen in the last 5 minutes.
    Sets key with TTL 300s if not present.
    """
    key = f"{DEDUP_PREFIX}{container_id}:{error_hash}"
    client = await get_redis_client()

    if client:
        try:
            # set(nx=True, ex=300) returns True if key was set (i.e. NEW error), None if key existed (DUPLICATE)
            is_new = await client.set(key, "1", nx=True, ex=DEDUP_TTL_SECONDS)
            return not is_new
        except Exception as exc:
            logger.debug(f"[RedisQueue] Redis dedup check error: {exc}")

    # In-memory fallback
    now = time.time()
    last_seen = _in_memory_dedup.get(key, 0)
    if now - last_seen < DEDUP_TTL_SECONDS:
        return True

    _in_memory_dedup[key] = now
    return False


async def enqueue_error_job(payload: Dict[str, Any]) -> bool:
    """
    Enqueue an error job into Redis 'ai_error_jobs' list.
    Fast execution (< 1ms) so terminal streaming is never blocked.
    """
    client = await get_redis_client()
    data = json.dumps(payload)

    if client:
        try:
            await client.rpush(QUEUE_KEY, data)
            logger.info(f"[RedisQueue] Enqueued job for error {payload.get('error_id')} to Redis")
            return True
        except Exception as exc:
            logger.debug(f"[RedisQueue] Failed to push to Redis: {exc}. Pushing to in-memory queue.")

    # Fallback to in-memory queue
    await _in_memory_queue.put(payload)
    logger.info(f"[RedisQueue] Enqueued job for error {payload.get('error_id')} to in-memory queue")
    return True


async def dequeue_error_job(timeout: float = 1.0) -> Optional[Dict[str, Any]]:
    """
    Pop an error job from Redis 'ai_error_jobs' list (BLPOP).
    Falls back to in-memory queue with zero latency when Redis is unreachable.
    """
    client = await get_redis_client()

    if client:
        try:
            res = await client.blpop(QUEUE_KEY, timeout=int(timeout))
            if res:
                _, raw_data = res
                return json.loads(raw_data)
        except Exception as exc:
            logger.debug(f"[RedisQueue] Redis blpop error: {exc}")

    # Zero-delay fallback to in-memory queue
    try:
        return await asyncio.wait_for(_in_memory_queue.get(), timeout=timeout)
    except asyncio.TimeoutError:
        return None
