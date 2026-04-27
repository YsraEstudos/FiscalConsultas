"""Facade do repositório NBS.

A implementação concreta foi dividida em ``backend.infrastructure.repositories.nbs``
para manter esta classe fina, com nomes canônicos claros e aliases de migração.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from backend.config.settings import settings
from backend.infrastructure.db_engine import tenant_context

from .nbs.catalog import (
    load_nbs_catalog_entries,
    load_nbs_catalog_item_details,
    load_nbs_catalog_tree_page,
)
from .nbs.snapshot import (
    snapshot_nbs_catalog_counts,
    snapshot_nbs_catalog_metadata,
)
from .nbs.types import (
    NBS_REPOSITORY_ALLOWED_TABLES,
    NBS_REPOSITORY_DEFAULT_TREE_PAGE_SIZE,
    NBS_REPOSITORY_MAX_ANCESTOR_DEPTH,
    NBS_REPOSITORY_MAX_TREE_PAGE_SIZE,
)

MAX_ANCESTOR_DEPTH = NBS_REPOSITORY_MAX_ANCESTOR_DEPTH
DEFAULT_TREE_PAGE_SIZE = NBS_REPOSITORY_DEFAULT_TREE_PAGE_SIZE
MAX_TREE_PAGE_SIZE = NBS_REPOSITORY_MAX_TREE_PAGE_SIZE
NBS_ALLOWED_TABLES = NBS_REPOSITORY_ALLOWED_TABLES


class NbsRepository:
    """Repository do catálogo NBS."""

    def __init__(self, session: AsyncSession, tenant_id: Optional[str] = None):
        self.session = session
        self.is_postgres = settings.database.is_postgres
        self.tenant_id = tenant_id or tenant_context.get() or None

    async def load_nbs_catalog_entries(
        self, query: str, limit: int = 50
    ) -> list[dict[str, object]]:
        return await load_nbs_catalog_entries(self, query, limit=limit)

    async def search(self, query: str, limit: int = 50) -> list[dict[str, object]]:
        return await self.load_nbs_catalog_entries(query, limit=limit)

    async def load_nbs_catalog_item_details(
        self,
        code: str,
        *,
        include_tree: bool = True,
        page: int = 1,
        page_size: int = DEFAULT_TREE_PAGE_SIZE,
    ) -> dict[str, object]:
        return await load_nbs_catalog_item_details(
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
        return await self.load_nbs_catalog_item_details(
            code,
            include_tree=include_tree,
            page=page,
            page_size=page_size,
        )

    async def load_nbs_catalog_tree_page(
        self,
        code: str,
        *,
        page: int = 1,
        page_size: int = DEFAULT_TREE_PAGE_SIZE,
    ) -> dict[str, object]:
        return await load_nbs_catalog_tree_page(
            self,
            code,
            page=page,
            page_size=page_size,
        )

    async def get_tree_page(
        self,
        code: str,
        *,
        page: int = 1,
        page_size: int = DEFAULT_TREE_PAGE_SIZE,
    ) -> dict[str, object]:
        return await self.load_nbs_catalog_tree_page(
            code,
            page=page,
            page_size=page_size,
        )

    async def snapshot_nbs_catalog_counts(self) -> dict[str, int]:
        return await snapshot_nbs_catalog_counts(self)

    async def snapshot_nbs_catalog_metadata(self) -> dict[str, str]:
        return await snapshot_nbs_catalog_metadata(self)

    async def get_catalog_counts(self) -> dict[str, int]:
        return await self.snapshot_nbs_catalog_counts()

    async def get_catalog_metadata(self) -> dict[str, str]:
        return await self.snapshot_nbs_catalog_metadata()


__all__ = [
    "DEFAULT_TREE_PAGE_SIZE",
    "MAX_ANCESTOR_DEPTH",
    "MAX_TREE_PAGE_SIZE",
    "NBS_ALLOWED_TABLES",
    "NbsRepository",
]
