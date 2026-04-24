from __future__ import annotations

import re
from html import escape, unescape
from typing import cast

import aiosqlite
import orjson

from backend.config.exceptions import (
    DatabaseError,
    DatabaseNotFoundError,
    NotFoundError,
)
from backend.config.logging_config import service_logger as logger
from backend.utils.nbs_parser import (
    build_nbs_code_variants,
    clean_nbs_code,
)

from .types import (
    MAX_ANCESTOR_DEPTH,
    MAX_TREE_PAGE_SIZE,
    NBS_ALLOWED_TABLES,
    DEFAULT_TREE_PAGE_SIZE,
    NbsServiceState,
)


def normalize_nbs_page(page: int) -> int:
    return max(int(page or 1), 1)


def normalize_nbs_page_size(page_size: int) -> int:
    normalized = int(page_size or DEFAULT_TREE_PAGE_SIZE)
    return min(max(normalized, 1), MAX_TREE_PAGE_SIZE)


async def acquire_nbs_sqlite_connection(
    service: NbsServiceState,
) -> aiosqlite.Connection:
    if not service.db_path.exists():
        raise DatabaseNotFoundError(str(service.db_path))

    async with service._pool_lock:
        if service._pool:
            return service._pool.pop()

    try:
        conn = await aiosqlite.connect(service.db_path)
        conn.row_factory = aiosqlite.Row
        return conn
    except Exception as exc:
        logger.error("Failed to connect to services DB: %s", exc)
        raise DatabaseError(f"Services DB connection failed: {exc}") from exc


async def release_nbs_sqlite_connection(
    service: NbsServiceState, conn: aiosqlite.Connection
) -> None:
    async with service._pool_lock:
        if len(service._pool) < service._pool_max_size:
            service._pool.append(conn)
            return
    await conn.close()


async def load_nbs_table_columns(
    service: NbsServiceState, conn: aiosqlite.Connection, table: str
) -> set[str]:
    if table not in NBS_ALLOWED_TABLES:
        raise ValueError(f"Tabela não permitida para inspeção de schema: {table}")
    if table in service._schema_columns_cache:
        return service._schema_columns_cache[table]

    cursor = await conn.execute(f"PRAGMA table_info({table})")
    rows = await cursor.fetchall()
    cols = {row["name"] for row in rows}
    service._schema_columns_cache[table] = cols
    return cols


async def nbs_table_exists(conn: aiosqlite.Connection, table: str) -> bool:
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


def row_to_nbs_item(row: aiosqlite.Row) -> dict[str, object]:
    return {
        "code": row["code"],
        "code_clean": row["code_clean"],
        "description": row["description"],
        "parent_code": row["parent_code"],
        "level": row["level"],
        "has_nebs": bool(row["has_nebs"]),
    }


def row_to_nbs_explanatory_entry(row: aiosqlite.Row) -> dict[str, object]:
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


def sanitize_nbs_html_fields(
    entry: dict[str, object] | None,
) -> dict[str, object] | None:
    if not entry:
        return None

    sanitized = dict(entry)
    for field in ("body_text", "body_markdown"):
        value = sanitized.get(field)
        if isinstance(value, str):
            sanitized[field] = escape(unescape(value))

    return sanitized


def sanitize_nbs_detail_payload(
    payload: dict[str, object],
) -> dict[str, object]:
    sanitized_payload = orjson.loads(orjson.dumps(payload))
    if isinstance(sanitized_payload.get("nebs"), dict):
        sanitized_payload["nebs"] = sanitize_nbs_html_fields(
            cast(dict[str, object], sanitized_payload.get("nebs"))
        )
    if isinstance(sanitized_payload.get("entry"), dict):
        sanitized_payload["entry"] = sanitize_nbs_html_fields(
            cast(dict[str, object], sanitized_payload.get("entry"))
        )
    return sanitized_payload


def build_nbs_fts_query(normalized_query: str) -> str:
    tokens = re.findall(r"[0-9a-z]+", normalized_query or "")
    if not tokens:
        return ""
    return " AND ".join(f"{token}*" for token in tokens)


def build_nbs_excerpt(body_text: str, limit: int = 220) -> str:
    compact = " ".join((body_text or "").split())
    if len(compact) <= limit:
        return compact
    return f"{compact[: limit - 3].rstrip()}..."


def resolve_nbs_code_aliases(code: str) -> tuple[list[str], list[str]]:
    aliases = list(build_nbs_code_variants((code or "").strip()))
    clean_aliases = [
        clean_nbs_code(alias) for alias in aliases if clean_nbs_code(alias)
    ]
    return aliases, list(dict.fromkeys(clean_aliases))


def resolve_nbs_hierarchy_root(
    item: dict[str, object], ancestors: list[dict[str, object]]
) -> dict[str, object]:
    if int(item["level"]) <= 1:
        return item

    for ancestor in ancestors:
        if int(ancestor["level"]) == 1:
            return ancestor

    return ancestors[0] if ancestors else item


async def fetch_nbs_items_by_prefix(
    conn: aiosqlite.Connection,
    root_code: str,
    *,
    limit: int | None = None,
    offset: int = 0,
) -> list[dict[str, object]]:
    sql = """
        SELECT code, code_clean, description, parent_code, level, has_nebs
        FROM nbs_items
        WHERE code = ? OR code LIKE ?
        ORDER BY source_order ASC
        """
    params: list[object] = [root_code, f"{root_code}%"]
    if limit is not None:
        sql = f"{sql}\n LIMIT ? OFFSET ?"
        params.extend([limit, max(offset, 0)])
    cursor = await conn.execute(sql, params)
    rows = await cursor.fetchall()
    return [row_to_nbs_item(row) for row in rows]


async def fetch_nbs_tree_page_sqlite(
    conn: aiosqlite.Connection,
    root_code: str,
    *,
    page: int,
    page_size: int,
) -> dict[str, object]:
    normalized_page = normalize_nbs_page(page)
    normalized_page_size = normalize_nbs_page_size(page_size)
    offset = (normalized_page - 1) * normalized_page_size

    count_cursor = await conn.execute(
        """
        SELECT COUNT(*) AS total
        FROM nbs_items
        WHERE code = ? OR code LIKE ?
        """,
        (root_code, f"{root_code}%"),
    )
    count_row = await count_cursor.fetchone()
    total = int(count_row[0] if count_row else 0)
    items = await fetch_nbs_items_by_prefix(
        conn,
        root_code,
        limit=normalized_page_size,
        offset=offset,
    )
    return {
        "items": items,
        "page": normalized_page,
        "page_size": normalized_page_size,
        "total": total,
        "has_more": (offset + len(items)) < total,
    }


async def fetch_nbs_item_by_code(
    conn: aiosqlite.Connection, code: str
) -> dict[str, object]:
    raw_code = (code or "").strip()
    aliases, clean_aliases = resolve_nbs_code_aliases(raw_code)
    if not aliases and not clean_aliases:
        raise NotFoundError("Serviço NBS", raw_code)

    where_clauses: list[str] = []
    params: list[str] = []
    if aliases:
        where_clauses.append(f"code IN ({', '.join(['?'] * len(aliases))})")
        params.extend(aliases)
    if clean_aliases:
        where_clauses.append(f"code_clean IN ({', '.join(['?'] * len(clean_aliases))})")
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
    return row_to_nbs_item(row)


async def fetch_nbs_ancestors(
    conn: aiosqlite.Connection, item: dict[str, object]
) -> list[dict[str, object]]:
    ancestors: list[dict[str, object]] = []
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
        parent_item = row_to_nbs_item(parent_row)
        visited_codes.add(parent_item["code"])
        ancestors.append(parent_item)
        parent_code = parent_item["parent_code"]
        depth += 1

    ancestors.reverse()
    return ancestors
