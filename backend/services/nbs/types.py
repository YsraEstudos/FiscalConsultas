from __future__ import annotations

import asyncio
from collections.abc import Callable
from collections import OrderedDict
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Protocol, TypedDict

import aiosqlite

NBS_ALLOWED_TABLES = {"nbs_items", "nebs_entries", "catalog_metadata"}
MAX_ANCESTOR_DEPTH = 64
NBS_SEARCH_CACHE_SIZE = 64
NBS_DETAIL_CACHE_SIZE = 24
DEFAULT_TREE_PAGE = 1
DEFAULT_TREE_PAGE_SIZE = 50
MAX_TREE_PAGE_SIZE = 200
REPOSITORY_UNAVAILABLE_ERROR = "NBS repository unavailable"
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


class NbsRepositoryProtocol(Protocol):
    tenant_id: str | None

    async def load_nbs_catalog_entries(
        self, query: str, limit: int = 50
    ) -> list[dict[str, object]]: ...

    async def load_nbs_catalog_item_details(
        self,
        code: str,
        *,
        include_tree: bool = True,
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, object]: ...

    async def load_nbs_catalog_tree_page(
        self,
        code: str,
        *,
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, object]: ...

    async def snapshot_nbs_catalog_counts(self) -> dict[str, object]: ...

    async def snapshot_nbs_catalog_metadata(self) -> dict[str, str]: ...


class NbsServiceState(Protocol):
    db_path: Path
    _schema_columns_cache: dict[str, set[str]]
    _pool: list[aiosqlite.Connection]
    _pool_lock: asyncio.Lock
    _pool_max_size: int
    _repository: NbsRepositoryProtocol | None
    _repository_factory: (
        Callable[[], AbstractAsyncContextManager[NbsRepositoryProtocol]] | None
    )
    _use_repository: bool
    _search_cache: OrderedDict[str, bytes]
    _detail_cache: OrderedDict[str, bytes]
    _cache_lock: asyncio.Lock | None


class NbsSearchPayload(TypedDict):
    success: bool
    query: str
    normalized: str
    results: list[dict[str, object]]
    total: int


class NbsCatalogHealthPayload(TypedDict, total=False):
    status: str
    nbs_items: int
    nebs_entries: int
    metadata: dict[str, str]
    error: str


class NbsCatalogItemPayload(TypedDict, total=False):
    code: str
    code_clean: str
    description: str
    parent_code: str | None
    level: int


class NbsCatalogDetailPayload(TypedDict, total=False):
    success: bool
    item: dict[str, object]
    ancestors: list[dict[str, object]]
    children: list[dict[str, object]]
    chapter_root: dict[str, object]
    chapter_items: list[dict[str, object]]
    chapter_page: dict[str, object]
    nebs: dict[str, object] | None
    entry: dict[str, object] | None
