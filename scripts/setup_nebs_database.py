"""Parse data/nebs.pdf into services.db trusted entries and offline audit reports."""

from __future__ import annotations

import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

try:
    from backend.config.services_db_schema import (
        CATALOG_METADATA_CREATE_SQL,
        NEBS_ENTRIES_CREATE_SQL,
        NEBS_ENTRIES_FTS_CREATE_SQL,
        SERVICES_INDEXES_SQL,
    )
    from backend.config.settings import settings
    from backend.utils.nebs_parser import (
        NebsParseOutcome,
        calculate_file_sha256,
        parse_nebs_pdf,
        write_nebs_audit_report,
    )
except ModuleNotFoundError:
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from backend.config.services_db_schema import (
        CATALOG_METADATA_CREATE_SQL,
        NEBS_ENTRIES_CREATE_SQL,
        NEBS_ENTRIES_FTS_CREATE_SQL,
        SERVICES_INDEXES_SQL,
    )
    from backend.config.settings import settings
    from backend.utils.nebs_parser import (
        NebsParseOutcome,
        calculate_file_sha256,
        parse_nebs_pdf,
        write_nebs_audit_report,
    )


PDF_FILE = Path(__file__).resolve().parents[1] / "data" / "nebs.pdf"
DB_FILE = Path(settings.database.services_path)
REPORTS_DIR = Path(__file__).resolve().parents[1] / "reports" / "nebs"
AUDIT_CSV = REPORTS_DIR / "nebs_audit.csv"
AUDIT_JSON = REPORTS_DIR / "nebs_audit.json"


def _ensure_schema(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute(CATALOG_METADATA_CREATE_SQL)

    existing_tables = {
        row[0]
        for row in cursor.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    if "nebs_entries" in existing_tables:
        existing_columns = {
            row[1] for row in cursor.execute("PRAGMA table_info(nebs_entries)").fetchall()
        }
        required_columns = {
            "code_clean",
            "title_normalized",
            "body_normalized",
            "section_title",
            "parser_status",
            "parse_warnings",
            "source_hash",
        }
        if not required_columns.issubset(existing_columns):
            cursor.execute("DROP TABLE nebs_entries")

    cursor.execute(NEBS_ENTRIES_CREATE_SQL)
    cursor.execute(NEBS_ENTRIES_FTS_CREATE_SQL)
    for ddl in SERVICES_INDEXES_SQL:
        cursor.execute(ddl)
    conn.commit()


def _load_valid_nbs_items(conn: sqlite3.Connection) -> dict[str, str]:
    cursor = conn.execute(
        """
        SELECT code, description
        FROM nbs_items
        ORDER BY source_order ASC
        """
    )
    rows = cursor.fetchall()
    if not rows:
        raise RuntimeError("nbs_items está vazio. Execute setup_nbs_database.py antes.")
    return {row[0]: row[1] for row in rows}


def _replace_nebs_entries(conn: sqlite3.Connection, outcome: NebsParseOutcome) -> None:
    conn.execute("DELETE FROM nebs_entries")
    conn.execute("DELETE FROM nebs_entries_fts")
    conn.execute("UPDATE nbs_items SET has_nebs = 0")

    rows = [
        (
            entry.code,
            entry.code_clean,
            entry.title,
            entry.title_normalized,
            entry.body_text,
            entry.body_markdown,
            entry.body_normalized,
            entry.section_title,
            entry.page_start,
            entry.page_end,
            entry.parser_status,
            entry.parse_warnings,
            entry.source_hash,
            entry.updated_at,
        )
        for entry in outcome.entries
    ]
    conn.executemany(
        """
        INSERT INTO nebs_entries (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.executemany(
        """
        INSERT INTO nebs_entries_fts (
            code,
            title,
            body_text,
            section_title
        ) VALUES (?, ?, ?, ?)
        """,
        [
            (
                entry.code,
                entry.title,
                entry.body_text,
                entry.section_title or "",
            )
            for entry in outcome.entries
        ],
    )
    conn.executemany(
        "UPDATE nbs_items SET has_nebs = 1 WHERE code = ?",
        [(entry.code,) for entry in outcome.entries],
    )
    conn.commit()


def _write_metadata(
    conn: sqlite3.Connection, outcome: NebsParseOutcome, source_hash: str
) -> None:
    updated_at = datetime.now(UTC).replace(microsecond=0).isoformat()
    metadata = {
        "nebs_source_path": str(PDF_FILE),
        "nebs_source_hash": source_hash,
        "nebs_trusted_count": str(outcome.counts["trusted"]),
        "nebs_suspect_count": str(outcome.counts["suspect"]),
        "nebs_rejected_count": str(outcome.counts["rejected"]),
        "nebs_updated_at": updated_at,
        "nebs_audit_csv": str(AUDIT_CSV),
        "nebs_audit_json": str(AUDIT_JSON),
    }
    conn.executemany(
        "INSERT OR REPLACE INTO catalog_metadata (key, value) VALUES (?, ?)",
        metadata.items(),
    )
    conn.commit()


def main() -> int:
    if not PDF_FILE.exists():
        print(f"ERRO: arquivo NEBS não encontrado em {PDF_FILE}")
        return 1
    if not DB_FILE.exists():
        print(f"ERRO: banco services.db não encontrado em {DB_FILE}")
        return 1

    conn = sqlite3.connect(DB_FILE)
    try:
        _ensure_schema(conn)
        valid_nbs_items = _load_valid_nbs_items(conn)
        outcome = parse_nebs_pdf(PDF_FILE, valid_nbs_items=valid_nbs_items)
        write_nebs_audit_report(outcome, csv_path=AUDIT_CSV, json_path=AUDIT_JSON)
        _replace_nebs_entries(conn, outcome)
        source_hash = calculate_file_sha256(PDF_FILE)
        _write_metadata(conn, outcome, source_hash)
    finally:
        conn.close()

    print("Setup NEBS concluído")
    print(f"  Fonte: {PDF_FILE}")
    print(f"  Banco: {DB_FILE}")
    print(f"  Trusted: {outcome.counts['trusted']}")
    print(f"  Suspect: {outcome.counts['suspect']}")
    print(f"  Rejected: {outcome.counts['rejected']}")
    print(f"  Auditoria CSV: {AUDIT_CSV}")
    print(f"  Auditoria JSON: {AUDIT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
