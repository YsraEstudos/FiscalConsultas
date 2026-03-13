"""Build the SQLite catalog for NBS and placeholder NEBS entries.

Execution order matters: `_create_schema()` recreates the NBS schema and drops
the `nebs_entries` and `nebs_entries_fts` tables. Run this script before
`setup_nebs_database.py`, or rerun `setup_nebs_database.py` afterward to
restore NEBS data.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

try:
    from backend.config.services_db_schema import (
        CATALOG_METADATA_CREATE_SQL,
        NEBS_ENTRIES_CREATE_SQL,
        NEBS_ENTRIES_FTS_CREATE_SQL,
        NBS_ITEMS_CREATE_SQL,
        SERVICES_INDEXES_SQL,
    )
    from backend.config.settings import settings
    from backend.utils.hash_util import calculate_file_sha256
    from backend.utils.nbs_parser import ParsedNbsItem, build_nbs_items, iter_nbs_rows
except ModuleNotFoundError:
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from backend.config.services_db_schema import (
        CATALOG_METADATA_CREATE_SQL,
        NEBS_ENTRIES_CREATE_SQL,
        NEBS_ENTRIES_FTS_CREATE_SQL,
        NBS_ITEMS_CREATE_SQL,
        SERVICES_INDEXES_SQL,
    )
    from backend.config.settings import settings
    from backend.utils.hash_util import calculate_file_sha256
    from backend.utils.nbs_parser import ParsedNbsItem, build_nbs_items, iter_nbs_rows


DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "nbs.csv"
DB_FILE = Path(settings.database.services_path)


def _confirm_destructive_schema_reset(db_file: Path) -> bool:
    if not db_file.exists():
        return True

    print(
        "AVISO: _create_schema() removerá `nebs_entries` e `nebs_entries_fts`. "
        "Execute setup_nebs_database.py depois deste script para restaurar os dados NEBS."
    )
    if os.getenv("CI") or not sys.stdin.isatty():
        return True

    answer = input(
        "This will remove nebs_entries and nebs_entries_fts. Continue? [y/N] "
    ).strip()
    return answer.lower() in {"y", "yes"}


def _create_schema(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("DROP TABLE IF EXISTS nebs_entries")
    cursor.execute("DROP TABLE IF EXISTS nebs_entries_fts")
    cursor.execute("DROP TABLE IF EXISTS nbs_items")
    cursor.execute("DROP TABLE IF EXISTS catalog_metadata")
    cursor.execute(CATALOG_METADATA_CREATE_SQL)
    cursor.execute(NBS_ITEMS_CREATE_SQL)
    cursor.execute(NEBS_ENTRIES_CREATE_SQL)
    cursor.execute(NEBS_ENTRIES_FTS_CREATE_SQL)
    for ddl in SERVICES_INDEXES_SQL:
        cursor.execute(ddl)
    conn.commit()


def _insert_metadata(
    conn: sqlite3.Connection, *, content_hash: str, item_count: int
) -> None:
    metadata = {
        "catalog": "nbs",
        "source_path": str(DATA_FILE),
        "source_hash": content_hash,
        "row_count": str(item_count),
    }
    conn.executemany(
        "INSERT OR REPLACE INTO catalog_metadata (key, value) VALUES (?, ?)",
        metadata.items(),
    )
    conn.commit()


def _insert_items(conn: sqlite3.Connection, items: list[ParsedNbsItem]) -> None:
    rows = [
        (
            item.code,
            item.code_clean,
            item.description,
            item.description_normalized,
            item.parent_code,
            item.level,
            item.source_order,
            item.sort_path,
            item.has_nebs,
        )
        for item in items
    ]
    conn.executemany(
        """
        INSERT INTO nbs_items (
            code,
            code_clean,
            description,
            description_normalized,
            parent_code,
            level,
            source_order,
            sort_path,
            has_nebs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()


def main() -> int:
    if not DATA_FILE.exists():
        print(f"ERRO: arquivo NBS não encontrado em {DATA_FILE}")
        return 1

    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    items = build_nbs_items(iter_nbs_rows(DATA_FILE))
    content_hash = calculate_file_sha256(DATA_FILE)
    if not _confirm_destructive_schema_reset(DB_FILE):
        print("Operação cancelada.")
        return 1

    conn = sqlite3.connect(DB_FILE)
    try:
        _create_schema(conn)
        _insert_items(conn, items)
        _insert_metadata(conn, content_hash=content_hash, item_count=len(items))
    finally:
        conn.close()

    print("Setup NBS concluído")
    print(f"  Fonte: {DATA_FILE}")
    print(f"  Banco: {DB_FILE}")
    print(f"  Itens: {len(items)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
