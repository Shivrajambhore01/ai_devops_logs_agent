"""
Redis Streams & Distributed AI Error Processing Service.
Provides:
1. Durable Redis Streams ('docker_ai_error_stream') with consumer groups ('ai-error-workers')
2. 5-minute SHA-256 fingerprint deduplication ('error_dedup:')
3. Hierarchical 24-hour AI diagnosis result cache ('ai_analysis:<fingerprint>')
4. Graceful in-memory fallback for local dev when Redis is offline.
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
STREAM_KEY = "docker_ai_error_stream"
CONSUMER_GROUP = "ai-error-workers"
DEDUP_PREFIX = "error_dedup:"
DEDUP_TTL_SECONDS = 300       # 5 minutes dedup
AI_CACHE_PREFIX = "ai_analysis:"
AI_CACHE_TTL_SECONDS = 86400  # 24 hours result cache

# In-memory fallback structures
_in_memory_queue: asyncio.Queue = asyncio.Queue()
_in_memory_dedup: Dict[str, float] = {}
_in_memory_ai_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}

_redis_client: Optional[Any] = None
_last_redis_attempt: float = 0.0
_redis_retry_interval: float = 30.0
_redis_offline_logged: bool = False
_group_created: bool = False


async def get_redis_client() -> Optional[Any]:
    """Lazy initialize redis.asyncio client with backoff cooldown."""
    global _redis_client, _last_redis_attempt, _redis_offline_logged
    if _redis_client is not None:
        return _redis_client

    now = time.time()
    if now - _last_redis_attempt < _redis_retry_interval:
        return None

    _last_redis_attempt = now
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=0.8)
        await asyncio.wait_for(client.ping(), timeout=0.8)
        _redis_client = client
        _redis_offline_logged = False
        logger.info(f"[RedisStreams] Connected to Redis at {REDIS_URL}")
        return _redis_client
    except Exception:
        if not _redis_offline_logged:
            logger.info("[RedisStreams] Redis not reachable. Operating with high-performance in-memory queues.")
            _redis_offline_logged = True
        _redis_client = None
        return None


async def ensure_consumer_group() -> None:
    """Ensure the consumer group exists on the Redis stream."""
    global _group_created
    if _group_created:
        return

    client = await get_redis_client()
    if not client:
        return

    try:
        await client.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
        _group_created = True
        logger.info(f"[RedisStreams] Created consumer group '{CONSUMER_GROUP}' on stream '{STREAM_KEY}'")
    except Exception as exc:
        # Group already exists (BUSYGROUP error in Redis)
        if "BUSYGROUP" in str(exc):
            _group_created = True
        else:
            logger.debug(f"[RedisStreams] xgroup_create status: {exc}")


async def is_error_duplicate(error_hash: str, container_id: str) -> bool:
    """Check if this error fingerprint was received in the last 5 minutes."""
    key = f"{DEDUP_PREFIX}{container_id}:{error_hash}"
    client = await get_redis_client()

    if client:
        try:
            is_new = await client.set(key, "1", nx=True, ex=DEDUP_TTL_SECONDS)
            return not is_new
        except Exception as exc:
            logger.debug(f"[RedisStreams] Redis dedup check error: {exc}")

    now = time.time()
    last_seen = _in_memory_dedup.get(key, 0)
    if now - last_seen < DEDUP_TTL_SECONDS:
        return True

    _in_memory_dedup[key] = now
    return False


async def get_cached_ai_analysis(fingerprint: str) -> Optional[Dict[str, Any]]:
    """
    Hierarchical AI Result Cache:
    Checks if this exact error fingerprint was already diagnosed within the last 24 hours.
    Returns cached diagnosis dictionary or None.
    """
    key = f"{AI_CACHE_PREFIX}{fingerprint}"
    client = await get_redis_client()

    if client:
        try:
            data = await client.get(key)
            if data:
                logger.info(f"[AICache] Cache HIT for fingerprint {fingerprint}")
                return json.loads(data)
        except Exception as exc:
            logger.debug(f"[AICache] Redis cache read error: {exc}")

    # In-memory cache check
    if key in _in_memory_ai_cache:
        expire_at, data = _in_memory_ai_cache[key]
        if time.time() < expire_at:
            logger.info(f"[AICache] In-memory cache HIT for fingerprint {fingerprint}")
            return data
        else:
            del _in_memory_ai_cache[key]

    return None


async def cache_ai_analysis(fingerprint: str, summary: Dict[str, Any], ttl_seconds: int = AI_CACHE_TTL_SECONDS) -> bool:
    """Store an AI diagnosis result in the 24-hour cache."""
    key = f"{AI_CACHE_PREFIX}{fingerprint}"
    client = await get_redis_client()
    raw = json.dumps(summary)

    if client:
        try:
            await client.set(key, raw, ex=ttl_seconds)
            return True
        except Exception as exc:
            logger.debug(f"[AICache] Redis cache write error: {exc}")

    _in_memory_ai_cache[key] = (time.time() + ttl_seconds, summary)
    return True


async def enqueue_error_job(payload: Dict[str, Any]) -> bool:
    """
    Enqueue an error job into Redis Stream 'docker_ai_error_stream'.
    Uses XADD with stream capping (maxlen=10000) for zero-memory bloat.
    """
    client = await get_redis_client()
    data = json.dumps(payload)

    if client:
        try:
            await ensure_consumer_group()
            msg_id = await client.xadd(STREAM_KEY, {"payload": data}, maxlen=10000, approximate=True)
            logger.info(f"[RedisStreams] XADD job {payload.get('error_id')} -> stream id {msg_id}")
            return True
        except Exception as exc:
            logger.debug(f"[RedisStreams] XADD failed: {exc}. Enqueuing to in-memory queue.")

    await _in_memory_queue.put(payload)
    logger.info(f"[RedisStreams] Enqueued job {payload.get('error_id')} to in-memory queue")
    return True


async def dequeue_error_job(consumer_name: str = "worker-1", timeout: float = 1.5) -> Optional[Tuple[str, Dict[str, Any]]]:
    """
    Read an error job from Redis Stream via XREADGROUP.
    Returns (stream_message_id, payload_dict) or None if timeout.
    """
    client = await get_redis_client()

    if client:
        try:
            await ensure_consumer_group()
            # Block for timeout ms
            block_ms = int(timeout * 1000)
            res = await client.xreadgroup(
                CONSUMER_GROUP,
                consumer_name,
                {STREAM_KEY: ">"},
                count=1,
                block=block_ms,
            )
            if res:
                for stream_name, messages in res:
                    for msg_id, fields in messages:
                        raw_payload = fields.get("payload")
                        if raw_payload:
                            return (msg_id, json.loads(raw_payload))
        except Exception as exc:
            logger.debug(f"[RedisStreams] xreadgroup error: {exc}")

    try:
        item = await asyncio.wait_for(_in_memory_queue.get(), timeout=timeout)
        return (f"mem_{uuid.uuid4().hex[:8]}", item)
    except asyncio.TimeoutError:
        return None


async def ack_error_job(msg_id: str) -> None:
    """Acknowledge completed stream message via XACK."""
    if msg_id.startswith("mem_"):
        return
    client = await get_redis_client()
    if client:
        try:
            await client.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
        except Exception as exc:
            logger.debug(f"[RedisStreams] XACK error for {msg_id}: {exc}")
