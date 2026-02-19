"""
Redis cache client for shared L2 caching.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Dict, List

import orjson

try:
    import redis.asyncio as aioredis  # type: ignore[import-untyped]

    _REDIS_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    aioredis = None  # type: ignore[assignment]
    _REDIS_AVAILABLE = False

from backend.config.settings import settings
from backend.config.logging_config import service_logger as logger


@dataclass
class RedisCache:
    url: str
    enabled: bool
    chapter_ttl: int
    fts_ttl: int
    _client: Any = field(default=None, repr=False)

    async def connect(self) -> None:
        if not self.enabled:
            return
        if not _REDIS_AVAILABLE:
            logger.warning("Redis disabled: redis package not available")
            return
        if self._client is not None:
            return
        self._client = aioredis.from_url(  # type: ignore[union-attr]
            self.url,
            decode_responses=False,
            socket_connect_timeout=2,
            socket_timeout=1,
            health_check_interval=30,
        )
        try:
            await self._client.ping()
            logger.info("Redis connected")
        except Exception as exc:
            logger.warning("Redis connect failed: %s", exc)
            self._client = None

    async def close(self) -> None:
        if self._client is None:
            return
        try:
            await (
                self._client.aclose()
            )  # aclose() is the non-deprecated path since redis 5.0.1
        except Exception as exc:
            logger.warning("Redis close failed: %s", exc)
        finally:
            self._client = None

    @property
    def available(self) -> bool:
        return self._client is not None

    async def get_json(self, key: str) -> Any:
        if self._client is None:
            return None
        try:
            payload = await self._client.get(key)
            if payload is None:
                return None
            return orjson.loads(payload)
        except Exception as exc:
            logger.debug("Redis get failed (%s): %s", key, exc)
            return None

    async def set_json(self, key: str, value: Any, ttl_seconds: int) -> None:
        if self._client is None:
            return
        try:
            payload = orjson.dumps(value)
            await self._client.set(key, payload, ex=ttl_seconds)
        except Exception as exc:
            logger.debug("Redis set failed (%s): %s", key, exc)

    async def get_chapter(self, chapter_num: str) -> Optional[Dict[str, Any]]:
        return await self.get_json(f"nesh:chapter:{chapter_num}")

    async def set_chapter(self, chapter_num: str, value: Dict[str, Any]) -> None:
        await self.set_json(f"nesh:chapter:{chapter_num}", value, self.chapter_ttl)

    async def get_fts(self, key: str) -> Optional[List[Any]]:
        return await self.get_json(f"nesh:fts:{key}")

    async def set_fts(self, key: str, value: List[Any]) -> None:
        await self.set_json(f"nesh:fts:{key}", value, self.fts_ttl)


redis_cache = RedisCache(
    url=settings.cache.redis_url,
    enabled=settings.cache.enable_redis,
    chapter_ttl=settings.cache.chapter_cache_ttl,
    fts_ttl=settings.cache.fts_cache_ttl,
)
