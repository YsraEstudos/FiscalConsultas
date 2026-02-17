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


ai_chat_rate_limiter = SlidingWindowRateLimiter(window_seconds=60)
