"""Shared schema cache helpers for SQLite metadata probes."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Generic, TypeVar

type DatabaseSignature = tuple[float, int] | None

T = TypeVar("T")


@dataclass
class _SchemaCacheEntry(Generic[T]):
    db_signature: DatabaseSignature
    value: T
    checked_at: float


class SchemaCache(Generic[T]):
    """Caches schema-derived values with TTL and DB signature invalidation.

    Example:
        cache = SchemaCache[set[str]]()
        columns = await cache.get_or_load(
            load=lambda: load_columns(conn),
            resolve_db_signature=get_db_signature,
        )
    """

    def __init__(self, ttl_seconds: int = 60) -> None:
        self._ttl_seconds = ttl_seconds
        self._entry: _SchemaCacheEntry[T] | None = None
        self._lock = asyncio.Lock()

    async def get_or_load(
        self,
        *,
        load: Callable[[], Awaitable[T]],
        resolve_db_signature: Callable[[], DatabaseSignature],
    ) -> T:
        """Returns the cached value or loads a fresh one when the DB changes.

        Example:
            schema = await cache.get_or_load(
                load=lambda: detect_schema(conn),
                resolve_db_signature=get_db_signature,
            )
        """
        now = time.time()
        signature = resolve_db_signature()
        async with self._lock:
            if self._entry is not None and self._entry.db_signature == signature:
                if now - self._entry.checked_at < self._ttl_seconds:
                    return self._entry.value
                self._entry.checked_at = now
                return self._entry.value

            value = await load()
            self._entry = _SchemaCacheEntry(
                db_signature=signature,
                value=value,
                checked_at=now,
            )
            return value
