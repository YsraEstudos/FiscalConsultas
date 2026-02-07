"""
Rate limiting utilitario para proteger endpoints sensiveis.

Implementacao local (in-memory) com janela deslizante.
Para ambiente com multiplos workers/instancias, migrar para Redis.
"""

from __future__ import annotations

from collections import deque
from math import ceil
from threading import Lock
import time


class SlidingWindowRateLimiter:
    """Rate limiter thread-safe por chave usando janela deslizante."""

    def __init__(self, window_seconds: int = 60):
        self.window_seconds = window_seconds
        self._buckets: dict[str, deque[float]] = {}
        self._lock = Lock()

    def consume(self, key: str, limit: int) -> tuple[bool, int]:
        """
        Consome 1 request da chave informada.

        Returns:
            (allowed, retry_after_seconds)
        """
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            bucket = self._buckets.setdefault(key, deque())

            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= limit:
                retry_after = max(1, ceil(self.window_seconds - (now - bucket[0])))
                return False, retry_after

            bucket.append(now)
            return True, 0

    def reset(self) -> None:
        """Limpa estado interno. Util para testes."""
        with self._lock:
            self._buckets.clear()


ai_chat_rate_limiter = SlidingWindowRateLimiter(window_seconds=60)
