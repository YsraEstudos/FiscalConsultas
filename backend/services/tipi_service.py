"""Serviço de busca na TIPI (Tabela de Incidência do IPI)."""

import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, AsyncIterator, Optional, cast

import aiosqlite

from ..config.exceptions import DatabaseError
from ..config.logging_config import service_logger as logger
from ..config.settings import settings
from ..utils.payload_cache_metrics import PayloadCacheMetrics
from .tipi.health import (
    probe_tipi_repository_catalog_health,
    probe_tipi_sqlite_catalog_health,
)
from .tipi.search import (
    build_empty_tipi_code_search_response,
    build_tipi_code_result_map,
    clone_tipi_code_search_result,
    fetch_tipi_chapter_catalog,
    get_chapter_positions,
    get_family_positions,
    load_tipi_rows_for_code,
    merge_tipi_multi_code_part_payloads,
    normalize_tipi_multi_code_parts,
    prefer_more_specific_tipi_posicao_alvo,
    read_tipi_code_search_cache,
    resolve_tipi_chapter_target_position,
    resolve_tipi_target_position,
    search_tipi_by_ncm_code,
    search_tipi_by_text_query,
    search_tipi_multi_code_parts,
    snapshot_tipi_internal_cache_metrics,
    write_tipi_code_search_cache,
)
from .tipi.types import (
    TipiChapterCatalogItem,
    TipiCodeCacheKey,
    TipiCodeSearchPayload,
    TipiHealthPayload,
    TipiRowBatch,
    TipiTextSearchPayload,
)

TIPI_SORT_WITH_NCM = "ncm_sort, ncm"
TIPI_SORT_FALLBACK = "ncm"
TIPI_ALLOWED_TABLES = {"tipi_positions", "tipi_chapters", "tipi_fts"}
TIPI_MULTI_CODE_MAX_PARTS = 25

get_session = None
try:
    from ..infrastructure.db_engine import get_session
    from ..infrastructure.repositories.tipi_repository import TipiRepository

    _REPO_AVAILABLE = True
except ImportError:
    _REPO_AVAILABLE = False
    TipiRepository = None

if TYPE_CHECKING:
    from ..infrastructure.repositories.tipi_repository import (
        TipiRepository as _TipiRepo,
    )


class TipiService:
    """
    Serviço para busca de NCMs na TIPI (Async).

    Features:
    - Busca por código NCM
    - Busca textual (FTS5)
    - Cache em memória
    - Connection pooling
    """

    _tipi_connection_pools: dict[Path, list[aiosqlite.Connection]] = {}
    _tipi_connection_pool_lock: Optional[asyncio.Lock] = None
    _tipi_connection_pool_max_size: int = 3

    def __init__(
        self,
        db_path: Path | None = None,
        *,
        repository: "_TipiRepo | None" = None,
        repository_factory=None,
    ):
        self.db_path = (db_path or Path(settings.database.tipi_path)).resolve()
        self._schema_columns_cache: dict[str, set[str]] = {}
        self._repository = repository
        self._repository_factory = repository_factory
        self._use_repository = repository is not None or repository_factory is not None

        self._code_search_cache: OrderedDict[
            TipiCodeCacheKey, TipiCodeSearchPayload
        ] = OrderedDict()
        self._chapter_positions_cache: OrderedDict[str, TipiRowBatch] = OrderedDict()
        self._code_search_cache_metrics = PayloadCacheMetrics("tipi_code_search_cache")
        self._chapter_positions_cache_metrics = PayloadCacheMetrics(
            "tipi_chapter_positions_cache"
        )
        self._cache_lock: Optional[asyncio.Lock] = None

        logger.info(
            "TipiService inicializado (modo: %s)",
            "Repository" if self._use_repository else "aiosqlite",
        )

    @classmethod
    async def initializeTipiServiceWithRepositoryFactory(cls) -> "TipiService":
        """
        Factory assíncrono para criar TipiService com TipiRepository.

        Uso:
            service = await TipiService.initializeTipiServiceWithRepositoryFactory()
            results = await service.searchTipiByTextQuery("bomba")
        """
        if not _REPO_AVAILABLE:
            raise RuntimeError("Repository não disponível. Instale sqlmodel.")
        if get_session is None:
            raise RuntimeError("Session factory não disponível.")
        session_factory = get_session
        repository_cls = cast("type[_TipiRepo]", TipiRepository)

        @asynccontextmanager
        async def repo_factory():
            async with session_factory() as session:
                yield repository_cls(session)

        return cls(repository_factory=repo_factory)

    @classmethod
    async def create_with_repository(cls) -> "TipiService":
        return await cls.initializeTipiServiceWithRepositoryFactory()

    def _get_cache_lock(self) -> asyncio.Lock:
        if self._cache_lock is None:
            self._cache_lock = asyncio.Lock()
        return self._cache_lock

    @asynccontextmanager
    async def _acquire_tipi_repository(self) -> AsyncIterator["_TipiRepo | None"]:
        if self._repository is not None:
            yield self._repository
            return
        if self._repository_factory is not None:
            async with self._repository_factory() as repo:
                yield repo
            return
        yield None

    @classmethod
    def _get_tipi_connection_pool_lock(cls) -> asyncio.Lock:
        if cls._tipi_connection_pool_lock is None:
            cls._tipi_connection_pool_lock = asyncio.Lock()
        return cls._tipi_connection_pool_lock

    async def _acquire_tipi_connection(self) -> aiosqlite.Connection:
        async with self._get_tipi_connection_pool_lock():
            pool = self._tipi_connection_pools.setdefault(self.db_path, [])
            if pool:
                return pool.pop()

        try:
            conn = await aiosqlite.connect(self.db_path)
            conn.row_factory = aiosqlite.Row
            return conn
        except Exception as exc:
            logger.error("Failed to connect to TIPI DB: %s", exc)
            raise DatabaseError(f"TIPI DB connection failed: {exc}")

    async def _release_tipi_connection(self, conn: aiosqlite.Connection) -> None:
        async with self._get_tipi_connection_pool_lock():
            pool = self._tipi_connection_pools.setdefault(self.db_path, [])
            if len(pool) < self._tipi_connection_pool_max_size:
                pool.append(conn)
                return
        try:
            await conn.close()
        except Exception as exc:
            logger.warning("Error closing TIPI connection: %s", exc)

    async def _load_tipi_table_columns(
        self, conn: aiosqlite.Connection, table: str
    ) -> set[str]:
        if table not in TIPI_ALLOWED_TABLES:
            raise ValueError(f"Tabela não permitida para inspeção de schema: {table}")
        if table in self._schema_columns_cache:
            return self._schema_columns_cache[table]

        cursor = await conn.execute(f"PRAGMA table_info({table})")
        rows = await cursor.fetchall()
        cols = {row["name"] for row in rows}
        self._schema_columns_cache[table] = cols
        return cols

    def _resolve_tipi_order_by_clause(self, cols: set[str]) -> str:
        return TIPI_SORT_WITH_NCM if "ncm_sort" in cols else TIPI_SORT_FALLBACK

    @staticmethod
    async def _close_tipi_pool_connections(
        connections: list[aiosqlite.Connection],
    ) -> None:
        for conn in connections:
            try:
                await conn.close()
            except Exception as exc:
                logger.warning("Error closing TIPI pool connection: %s", exc)

    @staticmethod
    def _trim_tipi_lru_cache_to_limit(
        cache: OrderedDict,
        max_size: int,
        metrics: PayloadCacheMetrics,
    ) -> None:
        limit = max(max_size, 0)
        while len(cache) > limit:
            cache.popitem(last=False)
            metrics.record_eviction()

    async def closeTipiConnectionPool(self) -> None:
        async with self._get_tipi_connection_pool_lock():
            pool = self._tipi_connection_pools.pop(self.db_path, [])
        await self._close_tipi_pool_connections(pool)

    @classmethod
    async def closeAllTipiConnectionPools(cls) -> None:
        async with cls._get_tipi_connection_pool_lock():
            pools = list(cls._tipi_connection_pools.values())
            cls._tipi_connection_pools = {}
        for pool in pools:
            await cls._close_tipi_pool_connections(pool)

    async def close(self):
        return await self.closeTipiConnectionPool()

    @classmethod
    async def close_all_pools(cls):
        return await cls.closeAllTipiConnectionPools()

    async def probeTipiCatalogHealth(self) -> TipiHealthPayload:
        if self._use_repository:
            return await self._probe_tipi_repository_catalog_health()
        return await self._probe_tipi_sqlite_catalog_health()

    async def check_connection(self) -> TipiHealthPayload:
        return await self.probeTipiCatalogHealth()

    async def _probe_tipi_repository_catalog_health(self) -> TipiHealthPayload:
        return await probe_tipi_repository_catalog_health(self)

    async def _probe_tipi_sqlite_catalog_health(self) -> TipiHealthPayload:
        return await probe_tipi_sqlite_catalog_health(self)

    def _build_empty_tipi_code_search_response(
        self, query: str
    ) -> TipiCodeSearchPayload:
        return build_empty_tipi_code_search_response(query)

    async def _get_chapter_positions(self, cap_num: str) -> TipiRowBatch:
        return await get_chapter_positions(self, cap_num)

    async def _get_family_positions(
        self, cap_num: str, prefix: str, ancestor_prefixes: set[str]
    ) -> TipiRowBatch:
        return await get_family_positions(self, cap_num, prefix, ancestor_prefixes)

    async def _read_tipi_code_search_cache(
        self, cache_key: TipiCodeCacheKey
    ) -> TipiCodeSearchPayload | None:
        return await read_tipi_code_search_cache(self, cache_key)

    @staticmethod
    def _clone_tipi_code_search_result(
        result: TipiCodeSearchPayload,
    ) -> TipiCodeSearchPayload:
        return clone_tipi_code_search_result(result)

    async def _write_tipi_code_search_cache(
        self, cache_key: TipiCodeCacheKey, result: TipiCodeSearchPayload
    ) -> None:
        await write_tipi_code_search_cache(self, cache_key, result)

    @staticmethod
    def _normalize_tipi_multi_code_parts(ncm_query: str) -> list[str]:
        return normalize_tipi_multi_code_parts(
            ncm_query, max_parts=TIPI_MULTI_CODE_MAX_PARTS
        )

    @staticmethod
    def _prefer_more_specific_tipi_posicao_alvo(
        current: str | None, incoming: str | None
    ) -> str | None:
        return prefer_more_specific_tipi_posicao_alvo(current, incoming)

    @staticmethod
    def _merge_tipi_multi_code_part_payloads(
        merged, part_resp: TipiCodeSearchPayload
    ) -> None:
        merge_tipi_multi_code_part_payloads(merged, part_resp)

    async def _search_tipi_multi_code_parts(
        self, ncm_query: str, view_mode: str, parts: list[str]
    ) -> TipiCodeSearchPayload:
        return await search_tipi_multi_code_parts(self, ncm_query, view_mode, parts)

    async def _load_tipi_rows_for_code(
        self, cap_num: str, clean_query: str, view_mode: str
    ) -> TipiRowBatch:
        return await load_tipi_rows_for_code(self, cap_num, clean_query, view_mode)

    @staticmethod
    def _resolve_tipi_target_position(
        clean_query: str, normalized_query: str, query_part: str
    ) -> str | None:
        return resolve_tipi_target_position(clean_query, normalized_query, query_part)

    @staticmethod
    def _resolve_tipi_chapter_target_position(
        capitulo: str, posicao_alvo: str | None
    ) -> str | None:
        return resolve_tipi_chapter_target_position(capitulo, posicao_alvo)

    def _build_tipi_code_result_map(self, rows: TipiRowBatch, posicao_alvo: str | None):
        return build_tipi_code_result_map(rows, posicao_alvo)

    async def searchTipiByNcmCode(
        self, ncm_query: str, view_mode: str = "family"
    ) -> TipiCodeSearchPayload:
        return await search_tipi_by_ncm_code(self, ncm_query, view_mode=view_mode)

    async def searchTipiByTextQuery(
        self, query: str, limit: int = 50
    ) -> TipiTextSearchPayload:
        return await search_tipi_by_text_query(self, query, limit=limit)

    async def fetchTipiChapterCatalog(self) -> list[TipiChapterCatalogItem]:
        return await fetch_tipi_chapter_catalog(self)

    async def snapshotTipiInternalCacheMetrics(self):
        async with self._get_cache_lock():
            return snapshot_tipi_internal_cache_metrics(self)

    async def get_internal_cache_metrics(self):
        """Alias compatível com a API anterior do serviço."""
        return await self.snapshotTipiInternalCacheMetrics()
