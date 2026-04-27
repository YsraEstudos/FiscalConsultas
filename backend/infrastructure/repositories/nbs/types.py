from __future__ import annotations

from typing import TypedDict

NBS_REPOSITORY_ALLOWED_TABLES = {"nbs_items", "nebs_entries", "catalog_metadata"}
NBS_REPOSITORY_MAX_ANCESTOR_DEPTH = 64
NBS_REPOSITORY_DEFAULT_TREE_PAGE_SIZE = 50
NBS_REPOSITORY_MAX_TREE_PAGE_SIZE = 200
NBS_EXPLANATORY_PUBLIC_FIELDS = (
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


class NbsCatalogItemPayload(TypedDict, total=False):
    code: str
    code_clean: str
    description: str
    parent_code: str | None
    level: int


class NbsCatalogSearchPayload(TypedDict):
    success: bool
    query: str
    normalized: str
    results: list[NbsCatalogItemPayload]
    total: int


class NbsCatalogTreePagePayload(TypedDict):
    items: list[NbsCatalogItemPayload]
    page: int
    page_size: int
    total: int
    has_more: bool


class NbsCatalogDetailPayload(TypedDict, total=False):
    success: bool
    item: NbsCatalogItemPayload
    ancestors: list[NbsCatalogItemPayload]
    children: list[NbsCatalogItemPayload]
    chapter_root: NbsCatalogItemPayload
    chapter_items: list[NbsCatalogItemPayload]
    chapter_page: NbsCatalogTreePagePayload
    nebs: dict[str, object] | None


class NbsExplanatoryEntryPayload(TypedDict, total=False):
    code: str
    code_clean: str
    title: str
    title_normalized: str
    body_text: str
    body_markdown: str
    body_normalized: str
    section_title: str
    page_start: int
    page_end: int
    parser_status: str
    parse_warnings: str | None
    source_hash: str
    updated_at: str


class NbsExplanatorySearchResultPayload(TypedDict):
    code: str
    title: str
    excerpt: str
    page_start: int
    page_end: int
    section_title: str


class NbsExplanatorySearchPayload(TypedDict):
    success: bool
    query: str
    normalized: str
    results: list[NbsExplanatorySearchResultPayload]
    total: int


class NbsExplanatoryDetailPayload(TypedDict, total=False):
    success: bool
    item: NbsCatalogItemPayload
    ancestors: list[NbsCatalogItemPayload]
    entry: NbsExplanatoryEntryPayload | None


class NbsCatalogCountsSnapshot(TypedDict):
    nbs_items: int
    nebs_entries: int


type NbsCatalogMetadataSnapshot = dict[str, str]
