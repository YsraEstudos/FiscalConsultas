"""
Rate limiting utilitario para proteger endpoints sensiveis.

Implementacao local (in-memory) com janela deslizante.
Para ambiente com multiplos workers/instancias, migrar para Redis.
"""

from __future__ import annotations

import asyncio
from collections import deque
from math import ceil
import time
import uuid

from backend.config.logging_config import service_logger as logger
from backend.infrastructure.redis_client import redis_cache


class SlidingWindowRateLimiter:
    """Rate limiter thread-safe por chave usando janela deslizante."""

    def __init__(self, window_seconds: int = 60):
        self.window_seconds = window_seconds
        self._buckets: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()
        self._last_cleanup_at = 0.0

    def _cleanup_stale_buckets(self, cutoff: float, now: float) -> None:
        if now - self._last_cleanup_at < self.window_seconds:
            return

        stale_keys: list[str] = []
        for bucket_key, bucket in self._buckets.items():
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if not bucket:
                stale_keys.append(bucket_key)

        for bucket_key in stale_keys:
            del self._buckets[bucket_key]

        self._last_cleanup_at = now

    async def consume(self, key: str, limit: int) -> tuple[bool, int]:
        """
        Consome 1 request da chave informada.

        Returns:
            (allowed, retry_after_seconds)
        """
        now = time.monotonic()
        cutoff = now - self.window_seconds

        async with self._lock:
            self._cleanup_stale_buckets(cutoff, now)
            bucket = self._buckets.setdefault(key, deque())

            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if not bucket and key in self._buckets:
                del self._buckets[key]
                bucket = self._buckets.setdefault(key, deque())

            if len(bucket) >= limit:
                retry_after = max(1, ceil(self.window_seconds - (now - bucket[0])))
                return False, retry_after

            bucket.append(now)
            return True, 0

    def reset(self) -> None:
        """Limpa estado interno. Util para testes."""
        self._buckets.clear()
        self._last_cleanup_at = 0.0


class RedisBackedRateLimiter:
    """Rate limiter com Redis compartilhado e fallback local em memória."""

    def __init__(
        self,
        *,
        window_seconds: int = 60,
        redis_prefix: str,
        fallback: SlidingWindowRateLimiter | None = None,
    ):
        self.window_seconds = window_seconds
        self.redis_prefix = redis_prefix
        self.fallback = fallback or SlidingWindowRateLimiter(window_seconds=window_seconds)

    def _redis_key(self, key: str) -> str:
        return f"{self.redis_prefix}:{key}"

    async def _consume_via_redis(self, key: str, limit: int) -> tuple[bool, int]:
        client = redis_cache._client
        if client is None:
            raise RuntimeError("Redis indisponível")

        now = time.time()
        cutoff = now - self.window_seconds
        redis_key = self._redis_key(key)

        await client.zremrangebyscore(redis_key, "-inf", cutoff)
        current_count = await client.zcard(redis_key)
        if current_count >= limit:
            oldest = await client.zrange(redis_key, 0, 0, withscores=True)
            oldest_score = float(oldest[0][1]) if oldest else now
            retry_after = max(1, ceil(self.window_seconds - (now - oldest_score)))
            return False, retry_after

        member = f"{now:.6f}:{uuid.uuid4().hex}"
        await client.zadd(redis_key, {member: now})
        await client.expire(redis_key, self.window_seconds)
        return True, 0

    async def consume(self, key: str, limit: int) -> tuple[bool, int]:
        if redis_cache.available:
            try:
                return await self._consume_via_redis(key, limit)
            except Exception as exc:
                logger.debug("Redis rate limiter fallback (%s): %s", self.redis_prefix, exc)
        return await self.fallback.consume(key, limit)

    def reset(self) -> None:
        self.fallback.reset()


ai_chat_rate_limiter = SlidingWindowRateLimiter(window_seconds=60)
services_search_rate_limiter = RedisBackedRateLimiter(
    window_seconds=60,
    redis_prefix="rate:services-search",
)
services_detail_rate_limiter = RedisBackedRateLimiter(
    window_seconds=60,
    redis_prefix="rate:services-detail",
)
