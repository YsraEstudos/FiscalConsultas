from __future__ import annotations

import asyncio
import hashlib
from collections import OrderedDict

import orjson

from backend.infrastructure.redis_client import redis_cache

from .types import (
    NBS_DETAIL_CACHE_SIZE,
    NBS_SEARCH_CACHE_SIZE,
    NbsRepositoryProtocol,
    NbsServiceState,
)

try:
    from backend.infrastructure.db_engine import tenant_context
except ImportError:  # pragma: no cover - optional dependency
    tenant_context = None


def get_nbs_cache_lock(service: NbsServiceState) -> asyncio.Lock:
    if service._cache_lock is None:
        service._cache_lock = asyncio.Lock()
    return service._cache_lock


def build_nbs_cache_key(*parts: object) -> str:
    serialized = "|".join(str(part) for part in parts)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def resolve_nbs_cache_scope(repo: NbsRepositoryProtocol | None = None) -> str:
    tenant_id = getattr(repo, "tenant_id", None)
    if not tenant_id and tenant_context is not None:
        tenant_id = tenant_context.get() or None
    return str(tenant_id or "public")


async def read_nbs_l1_cache_payload(
    service: NbsServiceState,
    cache: OrderedDict[str, bytes],
    key: str,
) -> dict[str, object] | None:
    async with get_nbs_cache_lock(service):
        cached = cache.get(key)
        if cached is None:
            return None
        cache.move_to_end(key)
    return orjson.loads(cached)


async def write_nbs_l1_cache_payload(
    service: NbsServiceState,
    cache: OrderedDict[str, bytes],
    key: str,
    payload: dict[str, object],
    *,
    max_size: int,
) -> None:
    encoded = orjson.dumps(payload)
    async with get_nbs_cache_lock(service):
        cache[key] = encoded
        cache.move_to_end(key)
        while len(cache) > max_size:
            cache.popitem(last=False)


async def read_nbs_search_cache_payload(
    service: NbsServiceState, namespace: str, scope: str, key: str
) -> dict[str, object] | None:
    cache_key = f"{namespace}:{scope}:{key}"
    cached = await read_nbs_l1_cache_payload(service, service._search_cache, cache_key)
    if cached is not None:
        return cached
    if not redis_cache.available:
        return None
    cached = await redis_cache.get_services_search(namespace, scope, key)
    if cached is None:
        return None
    await write_nbs_l1_cache_payload(
        service,
        service._search_cache,
        cache_key,
        cached,
        max_size=NBS_SEARCH_CACHE_SIZE,
    )
    return cached


async def write_nbs_search_cache_payload(
    service: NbsServiceState,
    namespace: str,
    scope: str,
    key: str,
    payload: dict[str, object],
) -> None:
    cache_key = f"{namespace}:{scope}:{key}"
    await write_nbs_l1_cache_payload(
        service,
        service._search_cache,
        cache_key,
        payload,
        max_size=NBS_SEARCH_CACHE_SIZE,
    )
    if redis_cache.available:
        await redis_cache.set_services_search(namespace, scope, key, payload)


async def read_nbs_detail_cache_payload(
    service: NbsServiceState, namespace: str, scope: str, key: str
) -> dict[str, object] | None:
    cache_key = f"{namespace}:{scope}:{key}"
    cached = await read_nbs_l1_cache_payload(service, service._detail_cache, cache_key)
    if cached is not None:
        return cached
    if not redis_cache.available:
        return None
    cached = await redis_cache.get_services_detail(namespace, scope, key)
    if cached is None:
        return None
    await write_nbs_l1_cache_payload(
        service,
        service._detail_cache,
        cache_key,
        cached,
        max_size=NBS_DETAIL_CACHE_SIZE,
    )
    return cached


async def write_nbs_detail_cache_payload(
    service: NbsServiceState,
    namespace: str,
    scope: str,
    key: str,
    payload: dict[str, object],
) -> None:
    cache_key = f"{namespace}:{scope}:{key}"
    await write_nbs_l1_cache_payload(
        service,
        service._detail_cache,
        cache_key,
        payload,
        max_size=NBS_DETAIL_CACHE_SIZE,
    )
    if redis_cache.available:
        await redis_cache.set_services_detail(namespace, scope, key, payload)

