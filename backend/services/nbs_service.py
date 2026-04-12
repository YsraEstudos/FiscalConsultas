"""Async service for the NBS / NEBS catalog.

Supports the legacy SQLite ``services.db`` mode and the PostgreSQL repository
mode used by the production/runtime path.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from collections import OrderedDict
from contextlib import asynccontextmanager
from copy import deepcopy
from html import escape
from pathlib import Path
from typing import TYPE_CHECKING, Any, AsyncIterator, cast

import aiosqlite

from backend.config.exceptions import (
    DatabaseError,
    DatabaseNotFoundError,
    NotFoundError,
)
from backend.config.logging_config import service_logger as logger
from backend.config.settings import settings
from backend.infrastructure.redis_client import redis_cache
from backend.utils.nbs_parser import (
    build_nbs_code_variants,
    clean_nbs_code,
    normalize_nbs_text,
)

get_session = None
tenant_context = None
try:
    from backend.infrastructure.db_engine import get_session, tenant_context
    from backend.infrastructure.repositories.nbs_repository import NbsRepository

    _REPO_AVAILABLE = True
except ImportError:
    _REPO_AVAILABLE = False
    NbsRepository = None

if TYPE_CHECKING:
    from backend.infrastructure.repositories.nbs_repository import (
        NbsRepository as _NbsRepository,
    )

NBS_ALLOWED_TABLES = {"nbs_items", "nebs_entries", "catalog_metadata"}
MAX_ANCESTOR_DEPTH = 64
SERVICE_SEARCH_CACHE_SIZE = 64
SERVICE_DETAIL_CACHE_SIZE = 64
NEBS_PUBLIC_FIELDS = (
    "code",
    "code_clean",
    "title",
    "title_normalized",
    "body_text",
    "body_markdown",
    "body_normalized",
    "section_title",
    "page_start",
    "page_end",
)


class NbsService:
    """Query helper for the NBS/NEBS catalog database."""

    def __init__(
        self,
        db_path: str | Path | None = None,
        *,
        repository: "_NbsRepository | None" = None,
        repository_factory=None,
    ):
        self.db_path = Path(db_path or settings.database.services_path)
        self._schema_columns_cache: dict[str, set[str]] = {}
        self._pool: list[aiosqlite.Connection] = []
        self._pool_lock = asyncio.Lock()
        self._pool_max_size = 2
        self._repository = repository
        self._repository_factory = repository_factory
        self._use_repository = repository is not None or repository_factory is not None
        self._search_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._detail_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._cache_lock: asyncio.Lock | None = None

        mode = "Repository" if self._use_repository else "aiosqlite"
        logger.info("NbsService inicializado (modo: %s)", mode)

    async def __aenter__(self) -> NbsService:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    @classmethod
    async def create_with_repository(cls) -> "NbsService":
        """Factory assíncrono para criar o serviço via repository/AsyncSession."""
        if not _REPO_AVAILABLE:
            raise RuntimeError("Repository não disponível. Instale sqlmodel.")
        if get_session is None:
            raise RuntimeError("Session factory não disponível.")
        repository_cls = cast("type[_NbsRepository]", NbsRepository)

        @asynccontextmanager
        async def repo_factory() -> AsyncIterator["_NbsRepository"]:
            async with get_session() as session:
                yield repository_cls(session)

        return cls(repository_factory=repo_factory)

    @asynccontextmanager
    async def _get_repo(self) -> AsyncIterator["_NbsRepository | None"]:
        if self._repository is not None:
            yield self._repository
            return
        if self._repository_factory is not None:
            async with self._repository_factory() as repo:
                yield repo
            return
        yield None

    def _get_cache_lock(self) -> asyncio.Lock:
        if self._cache_lock is None:
            self._cache_lock = asyncio.Lock()
        return self._cache_lock

    @staticmethod
    def _build_cache_key(*parts: Any) -> str:
        serialized = "|".join(str(part) for part in parts)
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    @staticmethod
    def _resolve_cache_scope(repo: "_NbsRepository | None" = None) -> str:
        tenant_id = getattr(repo, "tenant_id", None)
        if not tenant_id and tenant_context is not None:
            tenant_id = tenant_context.get() or None
        return str(tenant_id or "public")

    async def _get_l1_cached_payload(
        self,
        cache: OrderedDict[str, dict[str, Any]],
        key: str,
    ) -> dict[str, Any] | None:
        async with self._get_cache_lock():
            cached = cache.get(key)
            if cached is None:
                return None
            cache.move_to_end(key)
            return deepcopy(cached)

    async def _store_l1_payload(
        self,
        cache: OrderedDict[str, dict[str, Any]],
        key: str,
        payload: dict[str, Any],
        *,
        max_size: int,
    ) -> None:
        async with self._get_cache_lock():
            cache[key] = deepcopy(payload)
            cache.move_to_end(key)
            while len(cache) > max_size:
                cache.popitem(last=False)

    async def _get_cached_search_payload(
        self, namespace: str, scope: str, key: str
    ) -> dict[str, Any] | None:
        cache_key = f"{namespace}:{scope}:{key}"
        cached = await self._get_l1_cached_payload(self._search_cache, cache_key)
        if cached is not None:
            return cached
        if not redis_cache.available:
            return None
        cached = await redis_cache.get_services_search(namespace, scope, key)
        if cached is None:
            return None
        await self._store_l1_payload(
            self._search_cache,
            cache_key,
            cached,
            max_size=SERVICE_SEARCH_CACHE_SIZE,
        )
        return deepcopy(cached)

    async def _store_search_payload(
        self, namespace: str, scope: str, key: str, payload: dict[str, Any]
    ) -> None:
        cache_key = f"{namespace}:{scope}:{key}"
        await self._store_l1_payload(
            self._search_cache,
            cache_key,
            payload,
            max_size=SERVICE_SEARCH_CACHE_SIZE,
        )
        if redis_cache.available:
            await redis_cache.set_services_search(namespace, scope, key, payload)

    async def _get_cached_detail_payload(
        self, namespace: str, scope: str, key: str
    ) -> dict[str, Any] | None:
        cache_key = f"{namespace}:{scope}:{key}"
        cached = await self._get_l1_cached_payload(self._detail_cache, cache_key)
        if cached is not None:
            return cached
        if not redis_cache.available:
            return None
        cached = await redis_cache.get_services_detail(namespace, scope, key)
        if cached is None:
            return None
        await self._store_l1_payload(
            self._detail_cache,
            cache_key,
            cached,
            max_size=SERVICE_DETAIL_CACHE_SIZE,
        )
        return deepcopy(cached)

    async def _store_detail_payload(
        self, namespace: str, scope: str, key: str, payload: dict[str, Any]
    ) -> None:
        cache_key = f"{namespace}:{scope}:{key}"
        await self._store_l1_payload(
            self._detail_cache,
            cache_key,
            payload,
            max_size=SERVICE_DETAIL_CACHE_SIZE,
        )
        if redis_cache.available:
            await redis_cache.set_services_detail(namespace, scope, key, payload)

    async def _get_connection(self) -> aiosqlite.Connection:
        if not self.db_path.exists():
            raise DatabaseNotFoundError(str(self.db_path))

        async with self._pool_lock:
            if self._pool:
                return self._pool.pop()

        try:
            conn = await aiosqlite.connect(self.db_path)
            conn.row_factory = aiosqlite.Row
            return conn
        except Exception as exc:
            logger.error("Failed to connect to services DB: %s", exc)
            raise DatabaseError(f"Services DB connection failed: {exc}") from exc

    async def _release_connection(self, conn: aiosqlite.Connection) -> None:
        async with self._pool_lock:
            if len(self._pool) < self._pool_max_size:
                self._pool.append(conn)
                return
        await conn.close()

    async def close(self) -> None:
        async with self._pool_lock:
            while self._pool:
                conn = self._pool.pop()
                try:
                    await conn.close()
                except Exception as exc:
                    logger.warning("Error closing NBS pool connection: %s", exc)
        async with self._get_cache_lock():
            self._search_cache.clear()
            self._detail_cache.clear()

    async def check_connection(self) -> dict[str, Any]:
        """Return readiness, counts and metadata for the services catalog."""
        if self._use_repository:
            try:
                async with self._get_repo() as repo:
                    if repo is None:
                        raise RuntimeError("NBS repository unavailable")
                    counts = await repo.get_catalog_counts()
                    metadata = await repo.get_catalog_metadata()
                nbs_items = int(counts.get("nbs_items", 0))
                nebs_entries = int(counts.get("nebs_entries", 0))
                return {
                    "status": (
                        "online" if nbs_items > 0 and nebs_entries > 0 else "error"
                    ),
                    "nbs_items": nbs_items,
                    "nebs_entries": nebs_entries,
                    "metadata": metadata,
                }
            except Exception as exc:
                logger.error("NBS repository healthcheck failed: %s", exc)
                return {"status": "error", "error": str(exc)}

        if not self.db_path.exists():
            return {
                "status": "error",
                "error": f"Banco NBS não encontrado: {self.db_path}",
            }

        conn = await self._get_connection()
        try:
            nbs_count = 0
            nebs_count = 0
            metadata: dict[str, str] = {}

            if await self._table_exists(conn, "nbs_items"):
                cursor = await conn.execute("SELECT COUNT(*) FROM nbs_items")
                row = await cursor.fetchone()
                nbs_count = int(row[0] if row else 0)

            if await self._table_exists(conn, "nebs_entries"):
                cursor = await conn.execute(
                    "SELECT COUNT(*) FROM nebs_entries WHERE parser_status = 'trusted'"
                )
                row = await cursor.fetchone()
                nebs_count = int(row[0] if row else 0)

            if await self._table_exists(conn, "catalog_metadata"):
                cursor = await conn.execute("SELECT key, value FROM catalog_metadata")
                metadata = {row["key"]: row["value"] for row in await cursor.fetchall()}

            return {
                "status": "online" if nbs_count > 0 and nebs_count > 0 else "error",
                "nbs_items": nbs_count,
                "nebs_entries": nebs_count,
                "metadata": metadata,
            }
        except Exception as exc:
            logger.error("NBS SQLite healthcheck failed: %s", exc)
            return {"status": "error", "error": str(exc)}
        finally:
            await self._release_connection(conn)

    async def _get_table_columns(
        self, conn: aiosqlite.Connection, table: str
    ) -> set[str]:
        if table not in NBS_ALLOWED_TABLES:
            raise ValueError(f"Tabela não permitida para inspeção de schema: {table}")
        if table in self._schema_columns_cache:
            return self._schema_columns_cache[table]

        cursor = await conn.execute(f"PRAGMA table_info({table})")
        rows = await cursor.fetchall()
        cols = {row["name"] for row in rows}
        self._schema_columns_cache[table] = cols
        return cols

    async def _table_exists(self, conn: aiosqlite.Connection, table: str) -> bool:
        cursor = await conn.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type IN ('table', 'view') AND name = ?
            LIMIT 1
            """,
            (table,),
        )
        row = await cursor.fetchone()
        return row is not None

    @staticmethod
    def _row_to_item(row: aiosqlite.Row) -> dict[str, Any]:
        return {
            "code": row["code"],
            "code_clean": row["code_clean"],
            "description": row["description"],
            "parent_code": row["parent_code"],
            "level": row["level"],
            "has_nebs": bool(row["has_nebs"]),
        }

    @staticmethod
    def _row_to_nebs_entry_internal(row: aiosqlite.Row) -> dict[str, Any]:
        return {
            "code": row["code"],
            "code_clean": row["code_clean"],
            "title": row["title"],
            "title_normalized": row["title_normalized"],
            "body_text": row["body_text"],
            "body_markdown": row["body_markdown"],
            "body_normalized": row["body_normalized"],
            "section_title": row["section_title"],
            "page_start": row["page_start"],
            "page_end": row["page_end"],
            "parser_status": row["parser_status"],
            "parse_warnings": row["parse_warnings"],
            "source_hash": row["source_hash"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _to_public_nebs_entry(entry: dict[str, Any] | None) -> dict[str, Any] | None:
        if not entry:
            return None
        return NbsService._sanitize_nebs_html_fields(
            {field: entry[field] for field in NEBS_PUBLIC_FIELDS}
        )

    @staticmethod
    def _sanitize_nebs_html_fields(
        entry: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if not entry:
            return None

        sanitized = dict(entry)
        for field in ("body_text", "body_markdown"):
            value = sanitized.get(field)
            if isinstance(value, str):
                sanitized[field] = escape(value)

        return sanitized

    @classmethod
    def _sanitize_detail_payload(cls, payload: dict[str, Any]) -> dict[str, Any]:
        sanitized_payload = deepcopy(payload)
        if isinstance(sanitized_payload.get("nebs"), dict):
            sanitized_payload["nebs"] = cls._sanitize_nebs_html_fields(
                cast(dict[str, Any], sanitized_payload.get("nebs"))
            )
        if isinstance(sanitized_payload.get("entry"), dict):
            sanitized_payload["entry"] = cls._sanitize_nebs_html_fields(
                cast(dict[str, Any], sanitized_payload.get("entry"))
            )
        return sanitized_payload

    @staticmethod
    def _build_nebs_fts_query(normalized_query: str) -> str:
        tokens = re.findall(r"[0-9a-z]+", normalized_query or "")
        if not tokens:
            return ""
        return " AND ".join(f"{token}*" for token in tokens)

    @staticmethod
    def _build_excerpt(body_text: str, limit: int = 220) -> str:
        compact = " ".join((body_text or "").split())
        if len(compact) <= limit:
            return compact
        return f"{compact[: limit - 3].rstrip()}..."

    @staticmethod
    def _resolve_code_aliases(code: str) -> tuple[list[str], list[str]]:
        aliases = list(build_nbs_code_variants((code or "").strip()))
        clean_aliases = [
            clean_nbs_code(alias) for alias in aliases if clean_nbs_code(alias)
        ]
        return aliases, list(dict.fromkeys(clean_aliases))

    @staticmethod
    def _resolve_hierarchy_root(
        item: dict[str, Any], ancestors: list[dict[str, Any]]
    ) -> dict[str, Any]:
        if item["level"] <= 1:
            return item

        for ancestor in ancestors:
            if ancestor["level"] == 1:
                return ancestor

        return ancestors[0] if ancestors else item

    async def _fetch_items_by_prefix(
        self, conn: aiosqlite.Connection, root_code: str
    ) -> list[dict[str, Any]]:
        cursor = await conn.execute(
            """
            SELECT code, code_clean, description, parent_code, level, has_nebs
            FROM nbs_items
            WHERE code = ? OR code LIKE ?
            ORDER BY source_order ASC
            """,
            (root_code, f"{root_code}%"),
        )
        rows = await cursor.fetchall()
        return [self._row_to_item(row) for row in rows]

    async def _fetch_item_by_code(
        self, conn: aiosqlite.Connection, code: str
    ) -> dict[str, Any]:
        raw_code = (code or "").strip()
        aliases, clean_aliases = self._resolve_code_aliases(raw_code)
        if not aliases and not clean_aliases:
            raise NotFoundError("Serviço NBS", raw_code)

        where_clauses: list[str] = []
        params: list[str] = []
        if aliases:
            where_clauses.append(f"code IN ({', '.join(['?'] * len(aliases))})")
            params.extend(aliases)
        if clean_aliases:
            where_clauses.append(
                f"code_clean IN ({', '.join(['?'] * len(clean_aliases))})"
            )
            params.extend(clean_aliases)

        cursor = await conn.execute(
            f"""
            SELECT code, code_clean, description, parent_code, level, has_nebs
            FROM nbs_items
            WHERE {" OR ".join(where_clauses)}
            ORDER BY LENGTH(code_clean) DESC, source_order ASC
            LIMIT 1
            """,
            params,
        )
        row = await cursor.fetchone()
        if row is None:
            raise NotFoundError("Serviço NBS", raw_code)
        return self._row_to_item(row)

    async def _fetch_ancestors(
        self, conn: aiosqlite.Connection, item: dict[str, Any]
    ) -> list[dict[str, Any]]:
        ancestors: list[dict[str, Any]] = []
        parent_code = item["parent_code"]
        visited_codes = {item["code"]}
        depth = 0

        while parent_code:
            if depth >= MAX_ANCESTOR_DEPTH:
                logger.warning(
                    "Stopping ancestor traversal at max depth for NBS code %s",
                    item["code"],
                )
                break
            if parent_code in visited_codes:
                logger.warning(
                    "Detected cyclic NBS ancestor chain for code %s via parent %s",
                    item["code"],
                    parent_code,
                )
                break
            parent_cursor = await conn.execute(
                """
                SELECT code, code_clean, description, parent_code, level, has_nebs
                FROM nbs_items
                WHERE code = ?
                LIMIT 1
                """,
                (parent_code,),
            )
            parent_row = await parent_cursor.fetchone()
            if parent_row is None:
                break
            parent_item = self._row_to_item(parent_row)
            visited_codes.add(parent_item["code"])
            ancestors.append(parent_item)
            parent_code = parent_item["parent_code"]
            depth += 1

        ancestors.reverse()
        return ancestors

    async def search(self, query: str, *, limit: int = 50) -> dict[str, Any]:
        raw_query = (query or "").strip()
        normalized_query = normalize_nbs_text(raw_query)
        clean_query = clean_nbs_code(raw_query)
        cache_key = self._build_cache_key("nbs", raw_query, normalized_query, limit)
        scope = self._resolve_cache_scope(self._repository)
        cached = await self._get_cached_search_payload("nbs", scope, cache_key)
        if cached is not None:
            return cached

        if self._use_repository:
            async with self._get_repo() as repo:
                if repo is None:
                    raise RuntimeError("NBS repository unavailable")
                scoped_key = self._resolve_cache_scope(repo)
                if scoped_key != scope:
                    cached = await self._get_cached_search_payload(
                        "nbs", scoped_key, cache_key
                    )
                    if cached is not None:
                        return cached
                scope = scoped_key
                results = await repo.search(raw_query, limit=limit)
            payload = {
                "success": True,
                "query": raw_query,
                "normalized": normalized_query,
                "results": results,
                "total": len(results),
            }
            await self._store_search_payload("nbs", scope, cache_key, payload)
            return deepcopy(payload)

        conn = await self._get_connection()
        try:
            await self._get_table_columns(conn, "nbs_items")
            if not raw_query:
                cursor = await conn.execute(
                    """
                    SELECT code, code_clean, description, parent_code, level, has_nebs
                    FROM nbs_items
                    WHERE parent_code IS NULL
                    ORDER BY source_order ASC
                    LIMIT ?
                    """,
                    (limit,),
                )
                rows = await cursor.fetchall()
            elif not clean_query and not normalized_query:
                rows = []
            else:
                cursor = await conn.execute(
                    """
                    SELECT
                        code,
                        code_clean,
                        description,
                        parent_code,
                        level,
                        has_nebs,
                        CASE
                            WHEN code_clean = ? THEN 500
                            WHEN code = ? THEN 480
                            WHEN code_clean LIKE ? THEN 420
                            WHEN description_normalized = ? THEN 360
                            WHEN description_normalized LIKE ? THEN 320
                            ELSE 200
                        END AS match_score
                    FROM nbs_items
                    WHERE
                        (? <> '' AND code_clean = ?)
                        OR (? <> '' AND code_clean LIKE ?)
                        OR (? <> '' AND code LIKE ?)
                        OR (? <> '' AND description_normalized LIKE ?)
                    ORDER BY match_score DESC, LENGTH(code_clean) ASC, source_order ASC
                    LIMIT ?
                    """,
                    (
                        clean_query,
                        raw_query,
                        f"{clean_query}%",
                        normalized_query,
                        f"{normalized_query}%",
                        clean_query,
                        clean_query,
                        clean_query,
                        f"{clean_query}%",
                        raw_query,
                        f"{raw_query}%",
                        normalized_query,
                        f"%{normalized_query}%",
                        limit,
                    ),
                )
                rows = await cursor.fetchall()

            payload = {
                "success": True,
                "query": raw_query,
                "normalized": normalized_query,
                "results": [self._row_to_item(row) for row in rows],
                "total": len(rows),
            }
            await self._store_search_payload("nbs", scope, cache_key, payload)
            return deepcopy(payload)
        finally:
            await self._release_connection(conn)

    async def get_item_details(self, code: str) -> dict[str, Any]:
        normalized_code = (code or "").strip()
        cache_key = self._build_cache_key("nbs-detail", normalized_code)
        scope = self._resolve_cache_scope(self._repository)
        cached = await self._get_cached_detail_payload("nbs", scope, cache_key)
        if cached is not None:
            return cached

        if self._use_repository:
            async with self._get_repo() as repo:
                if repo is None:
                    raise RuntimeError("NBS repository unavailable")
                scoped_key = self._resolve_cache_scope(repo)
                if scoped_key != scope:
                    cached = await self._get_cached_detail_payload(
                        "nbs", scoped_key, cache_key
                    )
                    if cached is not None:
                        return cached
                scope = scoped_key
                payload = await repo.get_item_details(normalized_code)
            payload = self._sanitize_detail_payload(payload)
            await self._store_detail_payload("nbs", scope, cache_key, payload)
            return deepcopy(payload)

        conn = await self._get_connection()
        try:
            item = await self._fetch_item_by_code(conn, normalized_code)
            ancestors = await self._fetch_ancestors(conn, item)
            chapter_root = self._resolve_hierarchy_root(item, ancestors)

            children_cursor = await conn.execute(
                """
                SELECT code, code_clean, description, parent_code, level, has_nebs
                FROM nbs_items
                WHERE parent_code = ?
                ORDER BY source_order ASC
                """,
                (item["code"],),
            )
            child_rows = await children_cursor.fetchall()
            chapter_items = await self._fetch_items_by_prefix(
                conn, chapter_root["code"]
            )

            nebs_cursor = await conn.execute(
                """
                SELECT
                    code,
                    code_clean,
                    title,
                    title_normalized,
                    body_text,
                    body_markdown,
                    body_normalized,
                    section_title,
                    page_start,
                    page_end,
                    parser_status,
                    parse_warnings,
                    source_hash,
                    updated_at
                FROM nebs_entries
                WHERE code = ? AND parser_status = 'trusted'
                LIMIT 1
                """,
                (item["code"],),
            )
            nebs_row = await nebs_cursor.fetchone()
            nebs_payload = (
                None
                if nebs_row is None
                else self._to_public_nebs_entry(
                    self._row_to_nebs_entry_internal(nebs_row)
                )
            )

            payload = {
                "success": True,
                "item": item,
                "ancestors": ancestors,
                "children": [self._row_to_item(row) for row in child_rows],
                "chapter_root": chapter_root,
                "chapter_items": chapter_items,
                "nebs": nebs_payload,
            }
            await self._store_detail_payload("nbs", scope, cache_key, payload)
            return deepcopy(payload)
        finally:
            await self._release_connection(conn)

    async def search_nebs(self, query: str, *, limit: int = 50) -> dict[str, Any]:
        raw_query = (query or "").strip()
        normalized_query = normalize_nbs_text(raw_query)
        clean_query = clean_nbs_code(raw_query)
        fts_query = self._build_nebs_fts_query(normalized_query)
        cache_key = self._build_cache_key("nebs", raw_query, normalized_query, limit)
        scope = self._resolve_cache_scope(self._repository)
        cached = await self._get_cached_search_payload("nebs", scope, cache_key)
        if cached is not None:
            return cached

        if self._use_repository:
            async with self._get_repo() as repo:
                if repo is None:
                    raise RuntimeError("NBS repository unavailable")
                scoped_key = self._resolve_cache_scope(repo)
                if scoped_key != scope:
                    cached = await self._get_cached_search_payload(
                        "nebs", scoped_key, cache_key
                    )
                    if cached is not None:
                        return cached
                scope = scoped_key
                results = await repo.search_nebs(raw_query, limit=limit)
            payload = {
                "success": True,
                "query": raw_query,
                "normalized": normalized_query,
                "results": results,
                "total": len(results),
            }
            await self._store_search_payload("nebs", scope, cache_key, payload)
            return deepcopy(payload)

        conn = await self._get_connection()
        try:
            await self._get_table_columns(conn, "nebs_entries")
            has_fts = await self._table_exists(conn, "nebs_entries_fts")
            if not raw_query:
                rows = []
            elif not clean_query and not normalized_query:
                rows = []
            elif not has_fts:
                cursor = await conn.execute(
                    """
                    SELECT
                        code,
                        code_clean,
                        title,
                        section_title,
                        page_start,
                        page_end,
                        body_text,
                        CASE
                            WHEN code_clean = ? THEN 500
                            WHEN code = ? THEN 480
                            WHEN code_clean LIKE ? THEN 430
                            WHEN title_normalized = ? THEN 380
                            WHEN title_normalized LIKE ? THEN 340
                            WHEN body_normalized LIKE ? THEN 220
                            ELSE 180
                        END AS match_score
                    FROM nebs_entries
                    WHERE parser_status = 'trusted'
                      AND (
                        (? <> '' AND code_clean = ?)
                        OR (? <> '' AND code_clean LIKE ?)
                        OR (? <> '' AND code LIKE ?)
                        OR (? <> '' AND title_normalized LIKE ?)
                        OR (? <> '' AND body_normalized LIKE ?)
                      )
                    ORDER BY match_score DESC, LENGTH(code_clean) ASC, page_start ASC
                    LIMIT ?
                    """,
                    (
                        clean_query,
                        raw_query,
                        f"{clean_query}%",
                        normalized_query,
                        f"{normalized_query}%",
                        f"%{normalized_query}%",
                        clean_query,
                        clean_query,
                        clean_query,
                        f"{clean_query}%",
                        raw_query,
                        f"{raw_query}%",
                        normalized_query,
                        f"{normalized_query}%",
                        normalized_query,
                        f"%{normalized_query}%",
                        limit,
                    ),
                )
                rows = await cursor.fetchall()
            else:
                cursor = await conn.execute(
                    """
                    WITH fts_hits AS (
                        SELECT
                            code,
                            bm25(nebs_entries_fts, 8.0, 4.0, 1.0, 0.5) AS fts_rank
                        FROM nebs_entries_fts
                        WHERE ? <> '' AND nebs_entries_fts MATCH ?
                    )
                    SELECT
                        e.code,
                        e.code_clean,
                        e.title,
                        e.section_title,
                        e.page_start,
                        e.page_end,
                        e.body_text,
                        CASE
                            WHEN e.code_clean = ? THEN 500
                            WHEN e.code = ? THEN 480
                            WHEN e.code_clean LIKE ? THEN 430
                            WHEN e.title_normalized = ? THEN 380
                            WHEN e.title_normalized LIKE ? THEN 340
                            WHEN fts_hits.code IS NOT NULL THEN 220
                            ELSE 180
                        END AS match_score,
                        COALESCE(fts_hits.fts_rank, 999999.0) AS fts_rank
                    FROM nebs_entries AS e
                    LEFT JOIN fts_hits ON fts_hits.code = e.code
                    WHERE e.parser_status = 'trusted'
                      AND (
                        (? <> '' AND e.code_clean = ?)
                        OR (? <> '' AND e.code_clean LIKE ?)
                        OR (? <> '' AND e.code LIKE ?)
                        OR (? <> '' AND e.title_normalized LIKE ?)
                        OR fts_hits.code IS NOT NULL
                      )
                    ORDER BY match_score DESC, fts_rank ASC, LENGTH(e.code_clean) ASC, e.page_start ASC
                    LIMIT ?
                    """,
                    (
                        fts_query,
                        fts_query,
                        clean_query,
                        raw_query,
                        f"{clean_query}%",
                        normalized_query,
                        f"{normalized_query}%",
                        clean_query,
                        clean_query,
                        clean_query,
                        f"{clean_query}%",
                        raw_query,
                        f"{raw_query}%",
                        normalized_query,
                        f"{normalized_query}%",
                        limit,
                    ),
                )
                rows = await cursor.fetchall()

            results = [
                {
                    "code": row["code"],
                    "title": row["title"],
                    "excerpt": self._build_excerpt(row["body_text"]),
                    "page_start": row["page_start"],
                    "page_end": row["page_end"],
                    "section_title": row["section_title"],
                }
                for row in rows
            ]
            payload = {
                "success": True,
                "query": raw_query,
                "normalized": normalized_query,
                "results": results,
                "total": len(results),
            }
            await self._store_search_payload("nebs", scope, cache_key, payload)
            return deepcopy(payload)
        finally:
            await self._release_connection(conn)

    async def get_nebs_details(self, code: str) -> dict[str, Any]:
        normalized_code = (code or "").strip()
        cache_key = self._build_cache_key("nebs-detail", normalized_code)
        scope = self._resolve_cache_scope(self._repository)
        cached = await self._get_cached_detail_payload("nebs", scope, cache_key)
        if cached is not None:
            return cached

        if self._use_repository:
            async with self._get_repo() as repo:
                if repo is None:
                    raise RuntimeError("NBS repository unavailable")
                scoped_key = self._resolve_cache_scope(repo)
                if scoped_key != scope:
                    cached = await self._get_cached_detail_payload(
                        "nebs", scoped_key, cache_key
                    )
                    if cached is not None:
                        return cached
                scope = scoped_key
                payload = await repo.get_nebs_details(normalized_code)
            payload = self._sanitize_detail_payload(payload)
            await self._store_detail_payload("nebs", scope, cache_key, payload)
            return deepcopy(payload)

        conn = await self._get_connection()
        try:
            item = await self._fetch_item_by_code(conn, normalized_code)
            ancestors = await self._fetch_ancestors(conn, item)
            aliases, clean_aliases = self._resolve_code_aliases(normalized_code)
            entry_where_clauses: list[str] = []
            entry_params: list[str] = []
            if aliases:
                entry_where_clauses.append(
                    f"code IN ({', '.join(['?'] * len(aliases))})"
                )
                entry_params.extend(aliases)
            if clean_aliases:
                entry_where_clauses.append(
                    f"code_clean IN ({', '.join(['?'] * len(clean_aliases))})"
                )
                entry_params.extend(clean_aliases)
            entry_params.append("trusted")
            entry_cursor = await conn.execute(
                f"""
                SELECT
                    code,
                    code_clean,
                    title,
                    title_normalized,
                    body_text,
                    body_markdown,
                    body_normalized,
                    section_title,
                    page_start,
                    page_end,
                    parser_status,
                    parse_warnings,
                    source_hash,
                    updated_at
                FROM nebs_entries
                WHERE ({" OR ".join(entry_where_clauses)}) AND parser_status = ?
                ORDER BY LENGTH(code_clean) DESC
                LIMIT 1
                """,
                entry_params,
            )
            entry_row = await entry_cursor.fetchone()
            if entry_row is None:
                raise NotFoundError("Entrada NEBS", normalized_code)

            payload = {
                "success": True,
                "item": item,
                "ancestors": ancestors,
                "entry": self._to_public_nebs_entry(
                    self._row_to_nebs_entry_internal(entry_row)
                ),
            }
            await self._store_detail_payload("nebs", scope, cache_key, payload)
            return deepcopy(payload)
        finally:
            await self._release_connection(conn)
