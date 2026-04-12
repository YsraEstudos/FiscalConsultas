"""
Redis cache client for shared L2 caching.
"""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass, field
from time import perf_counter
from types import SimpleNamespace
from typing import Any, Awaitable, Callable, Dict, List, Optional

import orjson

try:
    import redis.asyncio as aioredis  # type: ignore[import-untyped]

    _REDIS_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    aioredis = SimpleNamespace(from_url=None)
    _REDIS_AVAILABLE = False

from backend.config.logging_config import service_logger as logger
from backend.config.settings import settings


@dataclass
class RedisCache:
    url: str
    enabled: bool
    max_payload_bytes: int
    chapter_ttl: int
    fts_ttl: int
    services_search_ttl: int
    services_detail_ttl: int
    status_ttl: int
    _client: Any = field(default=None, repr=False)
    _local_inflight: dict[str, asyncio.Future[Any]] = field(
        default_factory=dict, repr=False
    )
    _inflight_lock: asyncio.Lock = field(
        default_factory=asyncio.Lock, repr=False
    )
    _cache_version_prefix: str = field(default="meta:catalog-version", repr=False)
    _default_stale_ttl: int = field(default=60, repr=False)

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
            if self.max_payload_bytes > 0 and len(payload) > self.max_payload_bytes:
                logger.debug(
                    "Redis set skipped (%s): payload too large (%s > %s bytes)",
                    key,
                    len(payload),
                    self.max_payload_bytes,
                )
                return
            await self._client.set(key, payload, ex=ttl_seconds)
        except Exception as exc:
            logger.debug("Redis set failed (%s): %s", key, exc)

    async def delete(self, key: str) -> None:
        if self._client is None:
            return
        try:
            await self._client.delete(key)
        except Exception as exc:
            logger.debug("Redis delete failed (%s): %s", key, exc)

    async def set_if_not_exists(
        self, key: str, value: bytes, *, ttl_ms: int
    ) -> bool:
        if self._client is None:
            return False
        try:
            result = await self._client.set(key, value, nx=True, px=ttl_ms)
            return bool(result)
        except Exception as exc:
            logger.debug("Redis SET NX failed (%s): %s", key, exc)
            return False

    @staticmethod
    def normalize_cache_token(value: str | None) -> str:
        normalized = " ".join((value or "").strip().lower().split())
        return normalized or "-"

    @classmethod
    def hash_cache_token(cls, value: str | None) -> str:
        normalized = cls.normalize_cache_token(value)
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    async def get_catalog_version(self, catalog: str, scope: str = "public") -> str:
        key = f"{self._cache_version_prefix}:{catalog}:{scope}"
        value = await self.get_json(key)
        if value in (None, ""):
            return "v1"
        if isinstance(value, (str, int)):
            return f"v{value}"
        return "v1"

    async def bump_catalog_version(self, catalog: str, scope: str = "public") -> str:
        key = f"{self._cache_version_prefix}:{catalog}:{scope}"
        if self._client is None:
            return "v1"
        try:
            value = await self._client.incr(key)
            return f"v{value}"
        except Exception as exc:
            logger.debug("Redis version bump failed (%s): %s", key, exc)
            return "v1"

    async def _get_or_create_inflight_future(self, key: str) -> tuple[asyncio.Future[Any], bool]:
        async with self._inflight_lock:
            existing = self._local_inflight.get(key)
            if existing is not None:
                return existing, False
            future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
            self._local_inflight[key] = future
            return future, True

    async def _resolve_inflight_future(
        self, key: str, future: asyncio.Future[Any], *, result: Any = None, error: Exception | None = None
    ) -> None:
        async with self._inflight_lock:
            stored = self._local_inflight.get(key)
            if stored is future:
                self._local_inflight.pop(key, None)
        if error is not None:
            if not future.done():
                future.set_exception(error)
            return
        if not future.done():
            future.set_result(result)

    async def cached_json(
        self,
        key: str,
        *,
        ttl_seconds: int,
        loader: Callable[[], Awaitable[Any]],
        stale_ttl_seconds: int | None = None,
        lock_ttl_ms: int = 5000,
        lock_wait_seconds: float = 0.05,
        allow_stale: bool = True,
    ) -> tuple[Any, dict[str, float | str | bool]]:
        """
        Shared-cache helper with local in-flight dedupe, Redis lock, and stale fallback.
        """
        stale_ttl = (
            self._default_stale_ttl if stale_ttl_seconds is None else stale_ttl_seconds
        )
        stats: dict[str, float | str | bool] = {
            "cache_status": "miss",
            "stale_served": False,
            "coalesced": False,
            "lock_acquired": False,
            "elapsed_ms": 0.0,
        }
        started = perf_counter()

        cached = await self.get_json(key)
        if cached is not None:
            stats["cache_status"] = "hit"
            stats["elapsed_ms"] = round((perf_counter() - started) * 1000, 2)
            return cached, stats

        inflight_future, is_owner = await self._get_or_create_inflight_future(key)
        if not is_owner:
            try:
                shared = await inflight_future
                stats["cache_status"] = "coalesced"
                stats["coalesced"] = True
                stats["elapsed_ms"] = round((perf_counter() - started) * 1000, 2)
                return shared, stats
            except Exception:
                # If the owner failed, continue with a direct load path.
                pass

        lock_key = f"lock:{key}"
        stale_key = f"stale:{key}"
        lock_acquired = await self.set_if_not_exists(lock_key, b"1", ttl_ms=lock_ttl_ms)
        stats["lock_acquired"] = lock_acquired

        if not lock_acquired and allow_stale:
            stale_value = await self.get_json(stale_key)
            if stale_value is not None:
                stats["cache_status"] = "stale"
                stats["stale_served"] = True
                stats["elapsed_ms"] = round((perf_counter() - started) * 1000, 2)
                await self._resolve_inflight_future(key, inflight_future, result=stale_value)
                return stale_value, stats

        if not lock_acquired and lock_wait_seconds > 0:
            await asyncio.sleep(lock_wait_seconds)
            cached_retry = await self.get_json(key)
            if cached_retry is not None:
                stats["cache_status"] = "retry-hit"
                stats["elapsed_ms"] = round((perf_counter() - started) * 1000, 2)
                await self._resolve_inflight_future(key, inflight_future, result=cached_retry)
                return cached_retry, stats

        try:
            value = await loader()
            await self.set_json(key, value, ttl_seconds)
            if allow_stale:
                await self.set_json(stale_key, value, ttl_seconds + stale_ttl)
            stats["cache_status"] = "fill"
            stats["elapsed_ms"] = round((perf_counter() - started) * 1000, 2)
            await self._resolve_inflight_future(key, inflight_future, result=value)
            return value, stats
        except Exception as exc:
            await self._resolve_inflight_future(key, inflight_future, error=exc)
            raise
        finally:
            if lock_acquired:
                await self.delete(lock_key)

    async def get_versioned_json(
        self, namespace: str, catalog: str, scope: str, suffix: str
    ) -> Any:
        version = await self.get_catalog_version(catalog, scope)
        return await self.get_json(f"{namespace}:{version}:{scope}:{suffix}")

    async def set_versioned_json(
        self,
        namespace: str,
        catalog: str,
        scope: str,
        suffix: str,
        value: Any,
        ttl_seconds: int,
    ) -> None:
        version = await self.get_catalog_version(catalog, scope)
        await self.set_json(f"{namespace}:{version}:{scope}:{suffix}", value, ttl_seconds)

    async def get_chapter(self, chapter_num: str) -> Optional[Dict[str, Any]]:
        return await self.get_json(f"nesh:chapter:{chapter_num}")

    async def set_chapter(self, chapter_num: str, value: Dict[str, Any]) -> None:
        await self.set_json(f"nesh:chapter:{chapter_num}", value, self.chapter_ttl)

    async def get_fts(self, key: str) -> Optional[List[Any]]:
        return await self.get_json(f"nesh:fts:{key}")

    async def set_fts(self, key: str, value: List[Any]) -> None:
        await self.set_json(f"nesh:fts:{key}", value, self.fts_ttl)

    async def get_services_search(
        self, namespace: str, scope: str, key: str
    ) -> Optional[Dict[str, Any]]:
        return await self.get_versioned_json(
            f"services:{namespace}:search", namespace, scope, key
        )

    async def set_services_search(
        self, namespace: str, scope: str, key: str, value: Dict[str, Any]
    ) -> None:
        await self.set_versioned_json(
            f"services:{namespace}:search",
            namespace,
            scope,
            key,
            value,
            self.services_search_ttl,
        )

    async def get_services_detail(
        self, namespace: str, scope: str, key: str
    ) -> Optional[Dict[str, Any]]:
        return await self.get_versioned_json(
            f"services:{namespace}:detail", namespace, scope, key
        )

    async def set_services_detail(
        self, namespace: str, scope: str, key: str, value: Dict[str, Any]
    ) -> None:
        await self.set_versioned_json(
            f"services:{namespace}:detail",
            namespace,
            scope,
            key,
            value,
            self.services_detail_ttl,
        )

    async def get_status_snapshot(self, scope: str) -> Optional[Dict[str, Any]]:
        return await self.get_json(f"system:status:{scope}")

    async def set_status_snapshot(self, scope: str, value: Dict[str, Any]) -> None:
        await self.set_json(f"system:status:{scope}", value, self.status_ttl)


redis_cache = RedisCache(
    url=settings.cache.redis_url,
    enabled=settings.cache.enable_redis,
    max_payload_bytes=settings.cache.max_payload_bytes,
    chapter_ttl=settings.cache.chapter_cache_ttl,
    fts_ttl=settings.cache.fts_cache_ttl,
    services_search_ttl=settings.cache.services_search_ttl,
    services_detail_ttl=settings.cache.services_detail_ttl,
    status_ttl=settings.cache.status_cache_ttl,
)
