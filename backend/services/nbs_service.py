"""Async facade for the NBS / NEBS catalog.

Supports the legacy SQLite ``services.db`` mode and the PostgreSQL repository
mode used by the production/runtime path.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncContextManager, AsyncIterator, Callable, TYPE_CHECKING, cast

import aiosqlite

from backend.config.logging_config import service_logger as logger
from backend.config.settings import settings
from backend.infrastructure.redis_client import redis_cache

from .nbs.details import (
    fetch_nbs_catalog_item_details,
    fetch_nbs_catalog_tree_page,
    fetch_nbs_explanatory_entry_details,
)
from .nbs.health import probe_nbs_catalog_health
from .nbs.search import search_nbs_catalog_entries, search_nbs_explanatory_entries
from .nbs.types import (
    DEFAULT_TREE_PAGE,
    DEFAULT_TREE_PAGE_SIZE,
    MAX_TREE_PAGE_SIZE,
    NbsRepositoryProtocol,
)

get_session = None
NbsRepository = None
try:
    from backend.infrastructure.db_engine import get_session
    from backend.infrastructure.repositories.nbs_repository import NbsRepository

    _REPO_AVAILABLE = True
except ImportError:  # pragma: no cover - optional repository dependency
    _REPO_AVAILABLE = False
    NbsRepository = None

if TYPE_CHECKING:
    from backend.infrastructure.repositories.nbs_repository import (
        NbsRepository as _NbsRepository,
    )


class NbsService:
    """Query helper for the NBS/NEBS catalog database."""

    def __init__(
        self,
        db_path: str | Path | None = None,
        *,
        repository: NbsRepositoryProtocol | None = None,
        repository_factory: Callable[[], AsyncContextManager[NbsRepositoryProtocol]]
        | None = None,
    ):
        self.db_path = Path(db_path or settings.database.services_path)
        self._schema_columns_cache: dict[str, set[str]] = {}
        self._pool: list[aiosqlite.Connection] = []
        self._pool_lock = asyncio.Lock()
        self._pool_max_size = 2
        self._repository = repository
        self._repository_factory = repository_factory
        self._use_repository = repository is not None or repository_factory is not None
        self._search_cache: OrderedDict[str, bytes] = OrderedDict()
        self._detail_cache: OrderedDict[str, bytes] = OrderedDict()
        self._cache_lock: asyncio.Lock | None = None

        logger.info(
            "NbsService inicializado (modo: %s)",
            "Repository" if self._use_repository else "SQLite",
        )

    async def __aenter__(self) -> NbsService:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.shutdownNbsServiceResources()

    @classmethod
    async def initializeNbsServiceWithPostgresRepository(cls) -> "NbsService":
        """Cria `NbsService` com `NbsRepository` via SQLModel."""
        if not _REPO_AVAILABLE:
            raise RuntimeError("Repository não disponível. Instale sqlmodel.")
        if get_session is None:
            raise RuntimeError("Session factory não disponível.")
        repository_cls = cast("type[_NbsRepository]", NbsRepository)

        @asynccontextmanager
        async def repo_factory() -> AsyncIterator[NbsRepositoryProtocol]:
            async with get_session() as session:
                yield repository_cls(session)

        return cls(repository_factory=repo_factory)

    @classmethod
    async def create_with_repository(cls) -> "NbsService":
        return await cls.initializeNbsServiceWithPostgresRepository()

    async def shutdownNbsServiceResources(self) -> None:
        async with self._pool_lock:
            while self._pool:
                conn = self._pool.pop()
                try:
                    await conn.close()
                except Exception as exc:
                    logger.warning("Error closing NBS pool connection: %s", exc)
        if self._cache_lock is not None:
            async with self._cache_lock:
                self._search_cache.clear()
                self._detail_cache.clear()

    async def close(self) -> None:
        await self.shutdownNbsServiceResources()

    async def searchNbsCatalogEntries(
        self, query: str, *, limit: int = 50
    ) -> dict[str, object]:
        """Busca entradas NBS por código ou descrição."""
        return await search_nbs_catalog_entries(self, query, limit=limit)

    async def search(self, query: str, *, limit: int = 50) -> dict[str, object]:
        return await self.searchNbsCatalogEntries(query, limit=limit)

    async def fetchNbsCatalogItemDetails(
        self,
        code: str,
        *,
        include_tree: bool = True,
        page: int = 1,
        page_size: int = DEFAULT_TREE_PAGE_SIZE,
    ) -> dict[str, object]:
        """Recupera o detalhe de um item NBS e seu contexto hierárquico."""
        return await fetch_nbs_catalog_item_details(
            self,
            code,
            include_tree=include_tree,
            page=page,
            page_size=page_size,
        )

    async def get_item_details(
        self,
        code: str,
        *,
        include_tree: bool = True,
        page: int = 1,
        page_size: int = DEFAULT_TREE_PAGE_SIZE,
    ) -> dict[str, object]:
        return await self.fetchNbsCatalogItemDetails(
            code,
            include_tree=include_tree,
            page=page,
            page_size=page_size,
        )

    async def fetchNbsCatalogTreePage(
        self,
        code: str,
        *,
        page: int = 1,
        page_size: int = DEFAULT_TREE_PAGE_SIZE,
    ) -> dict[str, object]:
        """Recupera a página da árvore do capítulo NBS."""
        return await fetch_nbs_catalog_tree_page(
            self,
            code,
            page=page,
            page_size=page_size,
        )

    async def get_item_tree_page(
        self,
        code: str,
        *,
        page: int = 1,
        page_size: int = DEFAULT_TREE_PAGE_SIZE,
    ) -> dict[str, object]:
        return await self.fetchNbsCatalogTreePage(code, page=page, page_size=page_size)

    async def searchNbsExplanatoryEntries(
        self, query: str, *, limit: int = 50
    ) -> dict[str, object]:
        """Busca entradas NEBS por código ou texto."""
        return await search_nbs_explanatory_entries(self, query, limit=limit)

    async def search_nebs(self, query: str, *, limit: int = 50) -> dict[str, object]:
        return await self.searchNbsExplanatoryEntries(query, limit=limit)

    async def fetchNbsExplanatoryEntryDetails(self, code: str) -> dict[str, object]:
        """Recupera o detalhe NEBS canônico de um código."""
        return await fetch_nbs_explanatory_entry_details(self, code)

    async def get_nebs_details(self, code: str) -> dict[str, object]:
        return await self.fetchNbsExplanatoryEntryDetails(code)

    async def probeNbsCatalogHealth(self) -> dict[str, object]:
        """Executa o healthcheck do catálogo NBS/NEBS."""
        return await probe_nbs_catalog_health(self)

    async def check_connection(self) -> dict[str, object]:
        return await self.probeNbsCatalogHealth()


__all__ = [
    "DEFAULT_TREE_PAGE",
    "DEFAULT_TREE_PAGE_SIZE",
    "MAX_TREE_PAGE_SIZE",
    "NbsService",
    "redis_cache",
]
