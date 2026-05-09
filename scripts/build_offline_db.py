"""
Build Offline Database for Client-Side Search.

Consolidates data from nesh.db, tipi.db, and services.db into a single
optimized SQLite database with FTS5 indices, then encrypts it with
AES-256-GCM for secure distribution.

Usage:
    python scripts/build_offline_db.py

Output:
    database/fiscal_offline.enc     — Encrypted database blob
    database/fiscal_offline.meta    — JSON metadata (version, hashes, size)
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import struct
import sys
import time
from dataclasses import dataclass
from pathlib import Path

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
except ImportError:
    print("ERRO: cryptography não instalado. Execute: uv add cryptography")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_DIR = PROJECT_ROOT / "database"

NESH_DB = DB_DIR / "nesh.db"
TIPI_DB = DB_DIR / "tipi.db"
SERVICES_DB = DB_DIR / "services.db"
UNSPSC_DB = DB_DIR / "unspsc.db"
SQL_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

OUTPUT_DB = DB_DIR / "fiscal_offline.db"
OUTPUT_ENCRYPTED = DB_DIR / "fiscal_offline.enc"
OUTPUT_META = DB_DIR / "fiscal_offline.meta"

# ---------------------------------------------------------------------------
# Encryption constants
# ---------------------------------------------------------------------------
CHUNK_SIZE = 65536  # 64 KB per encrypted chunk
PBKDF2_ITERATIONS = 600_000
MAGIC = b"FCDB"  # File magic bytes
FORMAT_VERSION = 1
VERSION_TIMESTAMP_FORMAT = "%Y.%m.%d.%H%M%S"
BUILT_AT_TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
# The app seed is delivered by the authenticated token endpoint and is not
# embedded in the frontend bundle.


@dataclass(frozen=True)
class OfflineBundleOutput:
    source: str
    encrypted_path: Path
    metadata_path: Path
    version: str
    built_at: str
    size_bytes: int


def _log(msg: str) -> None:
    print(f"  [offline-db] {msg}")


def _resolve_app_seed() -> str:
    seed = (os.environ.get("OFFLINE_DB_APP_SEED") or "").strip()
    if seed:
        return seed

    if os.environ.get("CI"):
        raise RuntimeError(
            "OFFLINE_DB_APP_SEED must be configured in CI/release builds."
        )

    generated = secrets.token_hex(32)
    _log("WARNING: OFFLINE_DB_APP_SEED not set. Generated a local-only random seed.")
    return generated


_APP_SEED: str | None = None


def _get_app_seed() -> str:
    global _APP_SEED
    if _APP_SEED is None:
        _APP_SEED = _resolve_app_seed()
    return _APP_SEED


def _get_html_renderer():
    project_root_str = str(PROJECT_ROOT)
    if project_root_str not in sys.path:
        sys.path.insert(0, project_root_str)

    from backend.presentation.renderer import HtmlRenderer

    return HtmlRenderer


def _load_precomputed_notes(parsed_notes_json: object) -> dict[str, str]:
    if not parsed_notes_json:
        return {}

    raw_value = parsed_notes_json
    if isinstance(raw_value, bytes):
        raw_value = raw_value.decode("utf-8", errors="ignore")

    if isinstance(raw_value, str):
        try:
            raw_value = json.loads(raw_value)
        except json.JSONDecodeError:
            return {}

    if not isinstance(raw_value, dict):
        return {}

    return {
        str(note_id): str(note_value)
        for note_id, note_value in raw_value.items()
        if note_value is not None
    }


def _build_nesh_sections(notes_row: sqlite3.Row | None) -> dict[str, str | None] | None:
    if notes_row is None:
        return None

    sections = {
        "titulo": notes_row["titulo"],
        "notas": notes_row["notas"],
        "consideracoes": notes_row["consideracoes"],
        "definicoes": notes_row["definicoes"],
    }
    if not any(str(value or "").strip() for value in sections.values()):
        return None
    return sections


def _render_nesh_chapter_html(
    chapter_row: sqlite3.Row,
    notes_row: sqlite3.Row | None,
    positions: list[sqlite3.Row],
) -> str:
    content = str(chapter_row["content"] or "")
    if not content.strip():
        return ""

    html_renderer = _get_html_renderer()
    chapter_num = str(chapter_row["chapter_num"])
    chapter_payload = {
        "capitulo": chapter_num,
        "conteudo": content,
        "notas_gerais": notes_row["notes_content"] if notes_row else None,
        "notas_parseadas": _load_precomputed_notes(
            notes_row["parsed_notes_json"] if notes_row else None
        ),
        "posicoes": [
            {
                "codigo": str(position["codigo"]),
                "descricao": str(position["descricao"] or ""),
                "anchor_id": f"pos-{str(position['codigo']).replace('.', '-')}",
            }
            for position in positions
        ],
        "posicao_alvo": None,
        "real_content_found": True,
        "erro": None,
        "secoes": _build_nesh_sections(notes_row),
    }
    return html_renderer.render_chapter(chapter_payload)


def _initialize_output_db(output_path: Path) -> sqlite3.Connection:
    if output_path.exists():
        output_path.unlink()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(output_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=OFF")
    cursor.execute("PRAGMA page_size=4096")
    return conn


def _create_db_metadata(cursor: sqlite3.Cursor, source: str) -> tuple[str, str]:
    version = time.strftime(VERSION_TIMESTAMP_FORMAT, time.gmtime())
    built_at = time.strftime(BUILT_AT_TIMESTAMP_FORMAT, time.gmtime())
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS db_metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    cursor.executemany(
        "INSERT OR REPLACE INTO db_metadata (key, value) VALUES (?, ?)",
        [
            ("source", source),
            ("version", version),
            ("built_at", built_at),
        ],
    )
    return version, built_at


def _finalize_output_db(conn: sqlite3.Connection, output_path: Path) -> None:
    cursor = conn.cursor()
    _log("Running VACUUM...")
    cursor.execute("PRAGMA journal_mode=DELETE")
    cursor.execute("PRAGMA synchronous=FULL")
    conn.commit()
    cursor.execute("VACUUM")
    conn.commit()

    _log("Running integrity_check post-VACUUM...")
    cursor.execute("PRAGMA integrity_check")
    integrity_result = cursor.fetchone()
    if integrity_result and integrity_result[0] != "ok":
        raise RuntimeError(f"Integrity check failed: {integrity_result[0]}")
    _log("  Integrity: OK")

    conn.close()
    size_kb = output_path.stat().st_size / 1024
    _log(f"Consolidated DB: {size_kb:.1f} KB")


def _read_output_metadata(output_path: Path) -> tuple[str, str]:
    conn = sqlite3.connect(str(output_path))
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM db_metadata WHERE key = 'version'")
    version_row = cursor.fetchone()
    cursor.execute("SELECT value FROM db_metadata WHERE key = 'built_at'")
    built_row = cursor.fetchone()
    conn.close()

    version = (
        version_row[0]
        if version_row
        else time.strftime(VERSION_TIMESTAMP_FORMAT, time.gmtime())
    )
    built_at = (
        built_row[0]
        if built_row
        else time.strftime(BUILT_AT_TIMESTAMP_FORMAT, time.gmtime())
    )
    return version, built_at


# ---------------------------------------------------------------------------
# Step 1: Consolidate — Read from source DBs and write to a single offline DB
# ---------------------------------------------------------------------------
def _consolidate_databases(output_path: Path) -> None:
    """Read all source databases and create a single consolidated SQLite DB."""
    required_inputs = [SERVICES_DB, TIPI_DB, NESH_DB]
    missing = [path.name for path in required_inputs if not path.exists()]
    if missing:
        raise RuntimeError(
            f"Missing required offline DB inputs: {', '.join(sorted(missing))}"
        )

    if output_path.exists():
        output_path.unlink()

    conn = sqlite3.connect(str(output_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Performance pragmas
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=OFF")
    cursor.execute("PRAGMA page_size=4096")

    # --- NBS Items ---
    _log("Creating nbs_items table...")
    cursor.execute("""
        CREATE TABLE nbs_items (
            code TEXT PRIMARY KEY,
            code_clean TEXT NOT NULL,
            description TEXT NOT NULL,
            parent_code TEXT,
            level INTEGER NOT NULL DEFAULT 0,
            has_nebs INTEGER NOT NULL DEFAULT 0,
            source_order INTEGER
        )
    """)
    cursor.execute("CREATE INDEX idx_nbs_code_clean ON nbs_items(code_clean)")
    cursor.execute("CREATE INDEX idx_nbs_parent ON nbs_items(parent_code)")

    # --- NEBS Entries ---
    _log("Creating nebs_entries table...")
    cursor.execute("""
        CREATE TABLE nebs_entries (
            code TEXT PRIMARY KEY,
            code_clean TEXT NOT NULL,
            title TEXT NOT NULL,
            body_text TEXT,
            body_markdown TEXT,
            title_normalized TEXT,
            body_normalized TEXT,
            section_title TEXT,
            page_start INTEGER,
            page_end INTEGER
        )
    """)
    cursor.execute("CREATE INDEX idx_nebs_code_clean ON nebs_entries(code_clean)")

    # --- TIPI Positions ---
    _log("Creating tipi_positions table...")
    cursor.execute("""
        CREATE TABLE tipi_positions (
            ncm TEXT PRIMARY KEY,
            capitulo TEXT NOT NULL,
            descricao TEXT NOT NULL,
            aliquota TEXT,
            nivel INTEGER DEFAULT 0,
            ncm_sort TEXT
        )
    """)
    cursor.execute("CREATE INDEX idx_tipi_cap ON tipi_positions(capitulo)")

    # --- NESH Positions ---
    _log("Creating nesh_positions table...")
    cursor.execute("""
        CREATE TABLE nesh_positions (
            codigo TEXT PRIMARY KEY,
            descricao TEXT NOT NULL,
            chapter_num TEXT NOT NULL
        )
    """)
    cursor.execute("CREATE INDEX idx_nesh_chapter ON nesh_positions(chapter_num)")

    # --- NESH Chapters (full content for offline code search) ---
    _log("Creating nesh_chapters table...")
    cursor.execute("""
        CREATE TABLE nesh_chapters (
            chapter_num TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            rendered_html TEXT
        )
    """)

    # --- NESH Chapter Notes (structured notes for offline rendering) ---
    _log("Creating nesh_chapter_notes table...")
    cursor.execute("""
        CREATE TABLE nesh_chapter_notes (
            chapter_num TEXT PRIMARY KEY,
            notes_content TEXT,
            titulo TEXT,
            notas TEXT,
            consideracoes TEXT,
            definicoes TEXT,
            parsed_notes_json TEXT
        )
    """)

    # --- Metadata ---
    cursor.execute("""
        CREATE TABLE db_metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    conn.commit()

    # === Populate from source databases ===

    # NBS from services.db
    _log(f"Reading NBS from {SERVICES_DB}...")
    cursor.execute("ATTACH DATABASE ? AS svc", (str(SERVICES_DB),))  # nosec B608

    cursor.execute("""
            INSERT OR IGNORE INTO nbs_items
                (code, code_clean, description, parent_code, level, has_nebs, source_order)
            SELECT code, code_clean, description, parent_code, level,
                   has_nebs, source_order
            FROM svc.nbs_items
    """)
    nbs_count = cursor.rowcount
    _log(f"  Inserted {nbs_count} NBS items")

    cursor.execute(
        "SELECT 1 FROM svc.sqlite_master WHERE type='table' AND name='nebs_entries' LIMIT 1"
    )
    if cursor.fetchone():
        cursor.execute("""
                INSERT OR IGNORE INTO nebs_entries
                    (
                        code,
                        code_clean,
                        title,
                        body_text,
                        body_markdown,
                        title_normalized,
                        body_normalized,
                        section_title,
                        page_start,
                        page_end
                    )
                SELECT
                    code,
                    code_clean,
                    title,
                    body_text,
                    body_markdown,
                    title_normalized,
                    body_normalized,
                    section_title,
                    page_start,
                    page_end
                FROM svc.nebs_entries
        """)
        nebs_count = cursor.rowcount
        _log(f"  Inserted {nebs_count} NEBS entries")

    conn.commit()
    cursor.execute("DETACH DATABASE svc")

    # TIPI from tipi.db
    _log(f"Reading TIPI from {TIPI_DB}...")
    cursor.execute("ATTACH DATABASE ? AS tipi", (str(TIPI_DB),))  # nosec B608

    cursor.execute("""
            INSERT OR IGNORE INTO tipi_positions
                (ncm, capitulo, descricao, aliquota, nivel, ncm_sort)
            SELECT ncm, capitulo, descricao, aliquota, nivel, ncm_sort
            FROM tipi.tipi_positions
    """)
    tipi_count = cursor.rowcount
    _log(f"  Inserted {tipi_count} TIPI positions")

    conn.commit()
    cursor.execute("DETACH DATABASE tipi")

    # NESH positions + chapters + notes from nesh.db
    _log(f"Reading NESH from {NESH_DB}...")
    cursor.execute("ATTACH DATABASE ? AS nesh", (str(NESH_DB),))  # nosec B608

    cursor.execute("""
            INSERT OR IGNORE INTO nesh_positions (codigo, descricao, chapter_num)
            SELECT codigo, descricao, chapter_num
            FROM nesh.positions
    """)
    nesh_pos_count = cursor.rowcount
    _log(f"  Inserted {nesh_pos_count} NESH positions")

    # NESH chapters (full content for offline rendering)
    cursor.execute("""
            SELECT 1 FROM nesh.sqlite_master
            WHERE type='table' AND name='chapter_notes' LIMIT 1
    """)
    has_notes_table = cursor.fetchone() is not None

    notes_by_chapter, positions_by_chapter, chapter_rows = _load_nesh_render_context(
        conn, has_notes_table
    )
    cursor.executemany(
        """
        INSERT OR IGNORE INTO nesh_chapters (chapter_num, content, rendered_html)
        VALUES (?, ?, ?)
        """,
        [
            (
                str(row["chapter_num"]),
                row["content"],
                _render_nesh_chapter_html(
                    row,
                    notes_by_chapter.get(str(row["chapter_num"])),
                    positions_by_chapter.get(str(row["chapter_num"]), []),
                ),
            )
            for row in chapter_rows
        ],
    )
    nesh_ch_count = len(chapter_rows)
    _log(f"  Inserted {nesh_ch_count} NESH chapters")

    # NESH chapter notes (structured sections)
    if has_notes_table:
        cursor.execute("""
                INSERT OR IGNORE INTO nesh_chapter_notes
                    (chapter_num, notes_content, titulo, notas,
                     consideracoes, definicoes, parsed_notes_json)
                SELECT chapter_num, notes_content, titulo, notas,
                       consideracoes, definicoes, parsed_notes_json
                FROM nesh.chapter_notes
        """)
        nesh_notes_count = cursor.rowcount
        _log(f"  Inserted {nesh_notes_count} NESH chapter notes")

    conn.commit()
    cursor.execute("DETACH DATABASE nesh")

    conn.commit()

    # === Create FTS5 Indices ===
    _log("Creating FTS5 indices...")

    cursor.execute("""
        CREATE VIRTUAL TABLE nbs_fts USING fts5(
            code, code_clean, description,
            content='nbs_items',
            content_rowid='rowid'
        )
    """)
    cursor.execute("""
        INSERT INTO nbs_fts(nbs_fts) VALUES('rebuild')
    """)

    cursor.execute("""
        CREATE VIRTUAL TABLE nebs_fts USING fts5(
            code, code_clean, title, body_text,
            content='nebs_entries',
            content_rowid='rowid'
        )
    """)
    cursor.execute("""
        INSERT INTO nebs_fts(nebs_fts) VALUES('rebuild')
    """)

    cursor.execute("""
        CREATE VIRTUAL TABLE tipi_fts USING fts5(
            ncm, descricao, aliquota,
            content='tipi_positions',
            content_rowid='rowid'
        )
    """)
    cursor.execute("""
        INSERT INTO tipi_fts(tipi_fts) VALUES('rebuild')
    """)

    cursor.execute("""
        CREATE VIRTUAL TABLE nesh_fts USING fts5(
            codigo, descricao,
            content='nesh_positions',
            content_rowid='rowid'
        )
    """)
    cursor.execute("""
        INSERT INTO nesh_fts(nesh_fts) VALUES('rebuild')
    """)

    conn.commit()

    # === Insert metadata ===
    version = time.strftime(VERSION_TIMESTAMP_FORMAT, time.gmtime())
    cursor.executemany(
        "INSERT INTO db_metadata (key, value) VALUES (?, ?)",
        [
            ("version", version),
            ("built_at", time.strftime(BUILT_AT_TIMESTAMP_FORMAT, time.gmtime())),
        ],
    )
    conn.commit()

    # === Final compaction ===
    _log("Running VACUUM...")
    cursor.execute("PRAGMA journal_mode=DELETE")
    cursor.execute("PRAGMA synchronous=FULL")
    conn.commit()
    cursor.execute("VACUUM")
    conn.commit()

    # Integrity check post-VACUUM
    _log("Running integrity_check post-VACUUM...")
    cursor.execute("PRAGMA integrity_check")
    integrity_result = cursor.fetchone()
    if integrity_result and integrity_result[0] != "ok":
        raise RuntimeError(f"Integrity check failed: {integrity_result[0]}")
    _log("  Integrity: OK")

    conn.close()

    size_kb = output_path.stat().st_size / 1024
    _log(f"Consolidated DB: {size_kb:.1f} KB")


def _load_nesh_render_context(
    conn: sqlite3.Connection,
    has_notes_table: bool,
) -> tuple[dict[str, sqlite3.Row], dict[str, list[sqlite3.Row]], list[sqlite3.Row]]:
    notes_by_chapter: dict[str, sqlite3.Row] = {}
    if has_notes_table:
        for row in conn.execute("""
            SELECT chapter_num, notes_content, titulo, notas,
                   consideracoes, definicoes, parsed_notes_json
            FROM nesh.chapter_notes
            """):
            notes_by_chapter[str(row["chapter_num"])] = row

    positions_by_chapter: dict[str, list[sqlite3.Row]] = {}
    for row in conn.execute("""
        SELECT chapter_num, codigo, descricao
        FROM nesh.positions
        ORDER BY chapter_num, codigo
        """):
        positions_by_chapter.setdefault(str(row["chapter_num"]), []).append(row)

    chapter_rows = conn.execute("""
        SELECT chapter_num, content
        FROM nesh.chapters
        ORDER BY chapter_num
        """).fetchall()
    return notes_by_chapter, positions_by_chapter, chapter_rows


def _require_source_db(source: str, db_path: Path) -> None:
    if not db_path.exists():
        raise RuntimeError(
            f"Missing required {source.upper()} DB input: {db_path.name}"
        )


def _consolidate_nbs_database(output_path: Path) -> None:
    _require_source_db("nbs", SERVICES_DB)
    conn = _initialize_output_db(output_path)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE nbs_items (
            code TEXT PRIMARY KEY,
            code_clean TEXT NOT NULL,
            description TEXT NOT NULL,
            parent_code TEXT,
            level INTEGER NOT NULL DEFAULT 0,
            has_nebs INTEGER NOT NULL DEFAULT 0,
            source_order INTEGER
        )
    """)
    cursor.execute("CREATE INDEX idx_nbs_code_clean ON nbs_items(code_clean)")
    cursor.execute("CREATE INDEX idx_nbs_parent ON nbs_items(parent_code)")
    cursor.execute("""
        CREATE TABLE nebs_entries (
            code TEXT PRIMARY KEY,
            code_clean TEXT NOT NULL,
            title TEXT NOT NULL,
            body_text TEXT,
            body_markdown TEXT,
            title_normalized TEXT,
            body_normalized TEXT,
            section_title TEXT,
            page_start INTEGER,
            page_end INTEGER
        )
    """)
    cursor.execute("CREATE INDEX idx_nebs_code_clean ON nebs_entries(code_clean)")
    _create_db_metadata(cursor, "nbs")
    conn.commit()

    cursor.execute("ATTACH DATABASE ? AS svc", (str(SERVICES_DB),))  # nosec B608
    cursor.execute("""
        INSERT OR IGNORE INTO nbs_items
            (code, code_clean, description, parent_code, level, has_nebs, source_order)
        SELECT code, code_clean, description, parent_code, level,
               has_nebs, source_order
        FROM svc.nbs_items
    """)
    cursor.execute(
        "SELECT 1 FROM svc.sqlite_master WHERE type='table' AND name='nebs_entries' LIMIT 1"
    )
    if cursor.fetchone():
        cursor.execute("""
            INSERT OR IGNORE INTO nebs_entries
                (
                    code,
                    code_clean,
                    title,
                    body_text,
                    body_markdown,
                    title_normalized,
                    body_normalized,
                    section_title,
                    page_start,
                    page_end
                )
            SELECT
                code,
                code_clean,
                title,
                body_text,
                body_markdown,
                title_normalized,
                body_normalized,
                section_title,
                page_start,
                page_end
            FROM svc.nebs_entries
        """)
    conn.commit()
    cursor.execute("DETACH DATABASE svc")

    cursor.execute("""
        CREATE VIRTUAL TABLE nbs_fts USING fts5(
            code, code_clean, description,
            content='nbs_items',
            content_rowid='rowid'
        )
    """)
    cursor.execute("INSERT INTO nbs_fts(nbs_fts) VALUES('rebuild')")
    cursor.execute("""
        CREATE VIRTUAL TABLE nebs_fts USING fts5(
            code, code_clean, title, body_text,
            content='nebs_entries',
            content_rowid='rowid'
        )
    """)
    cursor.execute("INSERT INTO nebs_fts(nebs_fts) VALUES('rebuild')")
    conn.commit()
    _finalize_output_db(conn, output_path)


def _consolidate_tipi_database(output_path: Path) -> None:
    _require_source_db("tipi", TIPI_DB)
    conn = _initialize_output_db(output_path)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE tipi_positions (
            ncm TEXT PRIMARY KEY,
            capitulo TEXT NOT NULL,
            descricao TEXT NOT NULL,
            aliquota TEXT,
            nivel INTEGER DEFAULT 0,
            ncm_sort TEXT
        )
    """)
    cursor.execute("CREATE INDEX idx_tipi_cap ON tipi_positions(capitulo)")
    _create_db_metadata(cursor, "tipi")
    conn.commit()

    cursor.execute("ATTACH DATABASE ? AS tipi", (str(TIPI_DB),))  # nosec B608
    cursor.execute("""
        INSERT OR IGNORE INTO tipi_positions
            (ncm, capitulo, descricao, aliquota, nivel, ncm_sort)
        SELECT ncm, capitulo, descricao, aliquota, nivel, ncm_sort
        FROM tipi.tipi_positions
    """)
    conn.commit()
    cursor.execute("DETACH DATABASE tipi")

    cursor.execute("""
        CREATE VIRTUAL TABLE tipi_fts USING fts5(
            ncm, descricao, aliquota,
            content='tipi_positions',
            content_rowid='rowid'
        )
    """)
    cursor.execute("INSERT INTO tipi_fts(tipi_fts) VALUES('rebuild')")
    conn.commit()
    _finalize_output_db(conn, output_path)


def _consolidate_nesh_database(output_path: Path) -> None:
    _require_source_db("nesh", NESH_DB)
    conn = _initialize_output_db(output_path)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE nesh_positions (
            codigo TEXT PRIMARY KEY,
            descricao TEXT NOT NULL,
            chapter_num TEXT NOT NULL
        )
    """)
    cursor.execute("CREATE INDEX idx_nesh_chapter ON nesh_positions(chapter_num)")
    cursor.execute("""
        CREATE TABLE nesh_chapters (
            chapter_num TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            rendered_html TEXT
        )
    """)
    cursor.execute("""
        CREATE TABLE nesh_chapter_notes (
            chapter_num TEXT PRIMARY KEY,
            notes_content TEXT,
            titulo TEXT,
            notas TEXT,
            consideracoes TEXT,
            definicoes TEXT,
            parsed_notes_json TEXT
        )
    """)
    _create_db_metadata(cursor, "nesh")
    conn.commit()

    cursor.execute("ATTACH DATABASE ? AS nesh", (str(NESH_DB),))  # nosec B608
    cursor.execute("""
        INSERT OR IGNORE INTO nesh_positions (codigo, descricao, chapter_num)
        SELECT codigo, descricao, chapter_num
        FROM nesh.positions
    """)

    cursor.execute("""
        SELECT 1 FROM nesh.sqlite_master
        WHERE type='table' AND name='chapter_notes' LIMIT 1
    """)
    has_notes_table = cursor.fetchone() is not None

    notes_by_chapter, positions_by_chapter, chapter_rows = _load_nesh_render_context(
        conn, has_notes_table
    )
    cursor.executemany(
        """
        INSERT OR IGNORE INTO nesh_chapters (chapter_num, content, rendered_html)
        VALUES (?, ?, ?)
        """,
        [
            (
                str(row["chapter_num"]),
                row["content"],
                _render_nesh_chapter_html(
                    row,
                    notes_by_chapter.get(str(row["chapter_num"])),
                    positions_by_chapter.get(str(row["chapter_num"]), []),
                ),
            )
            for row in chapter_rows
        ],
    )
    if has_notes_table:
        cursor.execute("""
            INSERT OR IGNORE INTO nesh_chapter_notes
                (chapter_num, notes_content, titulo, notas,
                 consideracoes, definicoes, parsed_notes_json)
            SELECT chapter_num, notes_content, titulo, notas,
                   consideracoes, definicoes, parsed_notes_json
            FROM nesh.chapter_notes
        """)
    conn.commit()
    cursor.execute("DETACH DATABASE nesh")

    cursor.execute("""
        CREATE VIRTUAL TABLE nesh_fts USING fts5(
            codigo, descricao,
            content='nesh_positions',
            content_rowid='rowid'
        )
    """)
    cursor.execute("INSERT INTO nesh_fts(nesh_fts) VALUES('rebuild')")
    conn.commit()
    _finalize_output_db(conn, output_path)


def _source_columns(cursor: sqlite3.Cursor, attached_db: str, table: str) -> set[str]:
    columns = {
        str(row[1])
        for row in cursor.execute(f"PRAGMA {attached_db}.table_info({table})")
    }
    return {column for column in columns if SQL_IDENTIFIER_RE.fullmatch(column)}


def _source_text_expr(columns: set[str], column: str, fallback: str = "NULL") -> str:
    if column in columns:
        return column
    return fallback


def _consolidate_unspsc_database(output_path: Path) -> None:
    _require_source_db("unspsc", UNSPSC_DB)
    conn = _initialize_output_db(output_path)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE unspsc_items (
            code TEXT PRIMARY KEY,
            code_clean TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            segment TEXT,
            family TEXT,
            class TEXT,
            commodity TEXT
        )
    """)
    cursor.execute("CREATE INDEX idx_unspsc_code_clean ON unspsc_items(code_clean)")
    _create_db_metadata(cursor, "unspsc")
    conn.commit()

    cursor.execute("ATTACH DATABASE ? AS unspsc", (str(UNSPSC_DB),))  # nosec B608
    cursor.execute("""
        SELECT 1 FROM unspsc.sqlite_master
        WHERE type='table' AND name='unspsc_items' LIMIT 1
    """)
    if cursor.fetchone():
        columns = _source_columns(cursor, "unspsc", "unspsc_items")
        code_clean_fallback = "code" if "code" in columns else "''"
        title_fallback = "description" if "description" in columns else "NULL"
        code_clean_expr = _source_text_expr(
            columns,
            "code_clean",
            code_clean_fallback,
        )
        title_expr = _source_text_expr(columns, "title", title_fallback)
        description_expr = _source_text_expr(columns, "description")
        segment_expr = _source_text_expr(columns, "segment")
        family_expr = _source_text_expr(columns, "family")
        class_expr = _source_text_expr(columns, "class")
        commodity_expr = _source_text_expr(columns, "commodity")
        cursor.execute(f"""
            INSERT OR IGNORE INTO unspsc_items
                (
                    code,
                    code_clean,
                    title,
                    description,
                    segment,
                    family,
                    class,
                    commodity
                )
            SELECT
                code,
                COALESCE({code_clean_expr}, code),
                COALESCE({title_expr}, ''),
                {description_expr},
                {segment_expr},
                {family_expr},
                {class_expr},
                {commodity_expr}
            FROM unspsc.unspsc_items
        """)  # nosec B608
    conn.commit()
    cursor.execute("DETACH DATABASE unspsc")

    cursor.execute("""
        CREATE VIRTUAL TABLE unspsc_fts USING fts5(
            code, code_clean, title, description,
            content='unspsc_items',
            content_rowid='rowid'
        )
    """)
    cursor.execute("INSERT INTO unspsc_fts(unspsc_fts) VALUES('rebuild')")
    conn.commit()
    _finalize_output_db(conn, output_path)


SOURCE_CONSOLIDATORS = {
    "nbs": _consolidate_nbs_database,
    "nesh": _consolidate_nesh_database,
    "tipi": _consolidate_tipi_database,
    "unspsc": _consolidate_unspsc_database,
}


# ---------------------------------------------------------------------------
# Step 2: Encrypt the database file with AES-256-GCM
# ---------------------------------------------------------------------------
def _derive_key(salt: bytes) -> bytes:
    """Derive AES-256 key using PBKDF2 with the app seed."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return kdf.derive(_get_app_seed().encode("utf-8"))


def _compute_hmac(data: bytes, key: bytes) -> bytes:
    """Compute HMAC-SHA256 for integrity verification."""
    import hmac as hmac_mod

    return hmac_mod.new(key, data, hashlib.sha256).digest()


def _encrypt_database(plaintext_path: Path, encrypted_path: Path) -> dict:
    """
    Encrypt the plaintext DB with AES-256-GCM in chunks.

    File format:
        [MAGIC 4B] [VERSION 2B] [SALT 32B] [HMAC 32B] [CHUNK...]
        Each chunk: [IV 12B] [CIPHERTEXT+TAG <= 64KB + 16B]
    """
    plaintext = plaintext_path.read_bytes()
    plaintext_sha256 = hashlib.sha256(plaintext).hexdigest()

    # Generate random salt for this build
    salt = secrets.token_bytes(32)
    key = _derive_key(salt)

    # Compute HMAC over plaintext for integrity
    hmac_digest = _compute_hmac(plaintext, key)

    aesgcm = AESGCM(key)

    # Encrypt in chunks
    chunks: list[bytes] = []
    offset = 0
    while offset < len(plaintext):
        chunk_data = plaintext[offset : offset + CHUNK_SIZE]
        iv = secrets.token_bytes(12)
        ciphertext = aesgcm.encrypt(iv, chunk_data, None)
        # ciphertext includes the 16-byte GCM tag appended by cryptography lib
        chunks.append(iv + ciphertext)
        offset += CHUNK_SIZE

    # Assemble file
    header = MAGIC + struct.pack("<H", FORMAT_VERSION) + salt + hmac_digest
    encrypted_data = header + b"".join(chunks)

    encrypted_path.write_bytes(encrypted_data)
    encrypted_sha256 = hashlib.sha256(encrypted_data).hexdigest()

    _log(f"Encrypted DB: {len(encrypted_data) / 1024:.1f} KB ({len(chunks)} chunks)")

    return {
        "sha256": plaintext_sha256,
        "encrypted_sha256": encrypted_sha256,
        "salt": salt.hex(),
        "size_bytes": len(encrypted_data),
        "chunks": len(chunks),
    }


def _write_bundle_metadata(
    source: str,
    plaintext_path: Path,
    metadata_path: Path,
    crypto_info: dict,
) -> tuple[str, str]:
    version, built_at = _read_output_metadata(plaintext_path)
    meta = {
        "source": source,
        "version": version,
        "sha256": crypto_info["sha256"],
        "encrypted_sha256": crypto_info["encrypted_sha256"],
        "salt": crypto_info["salt"],
        "size_bytes": crypto_info["size_bytes"],
        "chunks": crypto_info["chunks"],
        "built_at": built_at,
        "format_version": FORMAT_VERSION,
        "chunk_size": CHUNK_SIZE,
        "pbkdf2_iterations": PBKDF2_ITERATIONS,
    }
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return version, built_at


def build_source_bundle(
    source: str,
    encrypted_path: Path,
    metadata_path: Path,
) -> OfflineBundleOutput:
    source_id = source.strip().lower()
    consolidator = SOURCE_CONSOLIDATORS.get(source_id)
    if consolidator is None:
        supported = ", ".join(sorted(SOURCE_CONSOLIDATORS))
        raise ValueError(
            f"Unsupported fiscal source '{source}'. Expected one of: {supported}"
        )

    encrypted_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    plaintext_path = encrypted_path.with_suffix(".db")

    _log(f"Building {source_id.upper()} source bundle...")
    consolidator(plaintext_path)
    try:
        crypto_info = _encrypt_database(plaintext_path, encrypted_path)
        version, built_at = _write_bundle_metadata(
            source_id,
            plaintext_path,
            metadata_path,
            crypto_info,
        )
    finally:
        plaintext_path.unlink(missing_ok=True)

    return OfflineBundleOutput(
        source=source_id,
        encrypted_path=encrypted_path,
        metadata_path=metadata_path,
        version=version,
        built_at=built_at,
        size_bytes=int(crypto_info["size_bytes"]),
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    print("=" * 60)
    print("Build Offline Database")
    print("=" * 60)

    # Step 1: Consolidate
    _log("Step 1/3: Consolidating databases...")
    _consolidate_databases(OUTPUT_DB)

    # Step 2: Encrypt
    _log("Step 2/3: Encrypting database...")
    crypto_info = _encrypt_database(OUTPUT_DB, OUTPUT_ENCRYPTED)

    # Step 3: Write metadata
    _log("Step 3/3: Writing metadata...")

    # Read version from the DB
    conn = sqlite3.connect(str(OUTPUT_DB))
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM db_metadata WHERE key = 'version'")
    version_row = cursor.fetchone()
    version = (
        version_row[0]
        if version_row
        else time.strftime(VERSION_TIMESTAMP_FORMAT, time.gmtime())
    )

    cursor.execute("SELECT value FROM db_metadata WHERE key = 'built_at'")
    built_row = cursor.fetchone()
    built_at = (
        built_row[0]
        if built_row
        else time.strftime(BUILT_AT_TIMESTAMP_FORMAT, time.gmtime())
    )
    conn.close()

    # Clean up plaintext DB (keep only encrypted version)
    OUTPUT_DB.unlink(missing_ok=True)

    meta = {
        "version": version,
        "sha256": crypto_info["sha256"],
        "encrypted_sha256": crypto_info["encrypted_sha256"],
        "salt": crypto_info["salt"],
        "size_bytes": crypto_info["size_bytes"],
        "chunks": crypto_info["chunks"],
        "built_at": built_at,
        "format_version": FORMAT_VERSION,
        "chunk_size": CHUNK_SIZE,
        "pbkdf2_iterations": PBKDF2_ITERATIONS,
    }
    OUTPUT_META.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    _log(f"Metadata written to {OUTPUT_META}")

    print("\n" + "=" * 60)
    print("BUILD COMPLETE")
    print(f"  Version:    {version}")
    print(f"  SHA-256:    {crypto_info['sha256'][:16]}...")
    print(f"  Encrypted:  {OUTPUT_ENCRYPTED}")
    print(f"  Size:       {crypto_info['size_bytes'] / 1024:.1f} KB")
    print(f"  Chunks:     {crypto_info['chunks']}")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
