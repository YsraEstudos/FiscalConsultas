import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure src is in path for imports to work
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from backend.config import CONFIG
from backend.config.settings import settings
from backend.server.app import app
from backend.utils.text_processor import NeshTextProcessor

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = PROJECT_ROOT / "snapshots" / "baseline_v1.json"


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table_name,),
    )
    return cur.fetchone() is not None


def _count_rows(conn: sqlite3.Connection, table_name: str) -> int:
    try:
        cur = conn.execute(f"SELECT COUNT(*) FROM {table_name}")
        return int(cur.fetchone()[0])
    except sqlite3.Error:
        return 0


def _is_nesh_db_ready(db_path: Path) -> bool:
    if not db_path.exists():
        return False

    try:
        conn = sqlite3.connect(db_path)
        try:
            required_tables = {"chapters", "positions", "chapter_notes", "search_index"}
            if not all(_table_exists(conn, table) for table in required_tables):
                return False
            if _count_rows(conn, "chapters") < 97:
                return False
            if _count_rows(conn, "search_index") < 1:
                return False
            positions_columns = {
                row[1]
                for row in conn.execute("PRAGMA table_info(positions)").fetchall()
            }
            if "anchor_id" not in positions_columns:
                return False
            return True
        finally:
            conn.close()
    except sqlite3.Error:
        return False


def _is_tipi_db_ready(db_path: Path) -> bool:
    if not db_path.exists():
        return False

    try:
        conn = sqlite3.connect(db_path)
        try:
            required_tables = {"tipi_chapters", "tipi_positions", "tipi_fts"}
            if not all(_table_exists(conn, table) for table in required_tables):
                return False
            if _count_rows(conn, "tipi_positions") < 6:
                return False

            columns = {
                row[1]
                for row in conn.execute("PRAGMA table_info(tipi_positions)").fetchall()
            }
            return {"ncm_sort", "parent_ncm", "nivel"}.issubset(columns)
        finally:
            conn.close()
    except sqlite3.Error:
        return False


def _seed_nesh_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if not db_path.exists():
        db_path.touch()

    processor = NeshTextProcessor(list(CONFIG.stopwords))

    chapter_templates = {
        "01": (
            "Capitulo 01 - Animais vivos.\n"
            "01.01 - Animais vivos da especie equina.\n"
            "01.02 - Animais vivos da especie bovina."
        ),
        "73": (
            "Capitulo 73 - Obras de ferro ou aco.\n"
            "73.18 - Parafusos, pinos e porcas de aco."
        ),
        "84": (
            "Capitulo 84 - Maquinas e aparelhos mecanicos.\n"
            "84.13 - Bombas para liquidos, inclusive bombas submersiveis.\n"
            "84.14 - Bombas de ar ou vacuo."
        ),
        "85": (
            "Capitulo 85 - Maquinas e aparelhos eletricos.\n"
            "85.17 - Aparelhos de telefone e comunicacao.\n"
            "85.18 - Maquinas de lavar com motor eletrico."
        ),
    }

    positions_by_chapter = {
        "01": [
            ("01.01", "Animais vivos da especie equina"),
            ("01.02", "Animais vivos da especie bovina"),
        ],
        "73": [("73.18", "Parafusos, pinos e porcas de aco")],
        "84": [
            ("84.13", "Bombas para liquidos, inclusive bombas submersiveis"),
            ("84.14", "Bombas de ar ou vacuo"),
        ],
        "85": [
            ("85.17", "Aparelhos de telefone e comunicacao"),
            ("85.18", "Maquinas de lavar com motor eletrico"),
        ],
    }

    chapter_rows = []
    note_rows = []
    position_rows = []

    for chapter_int in range(1, 98):
        chapter = f"{chapter_int:02d}"
        content = chapter_templates.get(
            chapter,
            f"Capitulo {chapter} - Conteudo de referencia.\n{chapter}.01 - Item generico do capitulo {chapter}.",
        )
        chapter_rows.append((chapter, content))
        note_rows.append(
            (
                chapter,
                f"Notas do capitulo {chapter}.",
                f"Capitulo {chapter}",
                f"Notas do capitulo {chapter}",
                "Consideracoes gerais",
                "Definicoes basicas",
            )
        )

        rows = positions_by_chapter.get(
            chapter,
            [(f"{chapter}.01", f"Item generico do capitulo {chapter}")],
        )
        for codigo, descricao in rows:
            anchor_id = f"pos-{codigo.replace('.', '-')}"
            position_rows.append((codigo, chapter, descricao, anchor_id))

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chapters (
                chapter_num TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                raw_text TEXT,
                tenant_id TEXT,
                search_vector TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS positions (
                codigo TEXT PRIMARY KEY,
                chapter_num TEXT NOT NULL,
                descricao TEXT,
                anchor_id TEXT,
                tenant_id TEXT,
                search_vector TEXT
            )
            """
        )
        positions_columns = {
            row[1] for row in conn.execute("PRAGMA table_info(positions)").fetchall()
        }
        if "anchor_id" not in positions_columns:
            conn.execute("ALTER TABLE positions ADD COLUMN anchor_id TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chapter_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chapter_num TEXT UNIQUE NOT NULL,
                notes_content TEXT,
                titulo TEXT,
                notas TEXT,
                consideracoes TEXT,
                definicoes TEXT,
                parsed_notes_json TEXT,
                tenant_id TEXT
            )
            """
        )
        chapter_notes_columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info(chapter_notes)").fetchall()
        }
        if "parsed_notes_json" not in chapter_notes_columns:
            conn.execute("ALTER TABLE chapter_notes ADD COLUMN parsed_notes_json TEXT")

        # Billing/multi-tenant tables used by webhook integration tests.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                subscription_plan TEXT NOT NULL DEFAULT 'free'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                full_name TEXT,
                tenant_id TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'asaas',
                provider_customer_id TEXT,
                provider_subscription_id TEXT UNIQUE,
                provider_payment_id TEXT,
                plan_name TEXT NOT NULL DEFAULT 'pro',
                status TEXT NOT NULL DEFAULT 'pending',
                amount REAL,
                billing_cycle TEXT,
                next_due_date TEXT,
                last_payment_date TEXT,
                last_event TEXT,
                raw_payload TEXT,
                created_at TEXT,
                updated_at TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_users_tenant_id ON users(tenant_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_subscriptions_tenant_id ON subscriptions(tenant_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_subscriptions_provider ON subscriptions(provider)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_subscriptions_provider_customer_id ON subscriptions(provider_customer_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_subscriptions_provider_subscription_id ON subscriptions(provider_subscription_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_subscriptions_provider_payment_id ON subscriptions(provider_payment_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_subscriptions_status ON subscriptions(status)"
        )

        if not _table_exists(conn, "search_index"):
            conn.execute(
                """
                CREATE VIRTUAL TABLE search_index USING fts5(
                    ncm,
                    display_text,
                    type,
                    description,
                    indexed_content
                )
                """
            )
        fts_columns = {
            row[1] for row in conn.execute("PRAGMA table_info(search_index)").fetchall()
        }
        uses_indexed_content = "indexed_content" in fts_columns

        conn.executemany(
            "INSERT OR IGNORE INTO chapters (chapter_num, content) VALUES (?, ?)",
            chapter_rows,
        )
        conn.executemany(
            """
            INSERT OR IGNORE INTO chapter_notes
                (chapter_num, notes_content, titulo, notas, consideracoes, definicoes)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            note_rows,
        )
        conn.executemany(
            "INSERT OR IGNORE INTO positions (codigo, chapter_num, descricao, anchor_id) VALUES (?, ?, ?, ?)",
            position_rows,
        )
        conn.execute(
            """
            UPDATE positions
            SET anchor_id = 'pos-' || REPLACE(codigo, '.', '-')
            WHERE anchor_id IS NULL OR anchor_id = ''
            """
        )

        for chapter_num, content in chapter_rows:
            ncm = chapter_num
            display_text = f"Capitulo {chapter_num}"
            text_for_search = processor.process(content)
            if uses_indexed_content:
                conn.execute(
                    """
                    INSERT INTO search_index (ncm, display_text, type, description, indexed_content)
                    SELECT ?, ?, ?, ?, ?
                    WHERE NOT EXISTS (
                        SELECT 1 FROM search_index WHERE ncm = ? AND type = ? LIMIT 1
                    )
                    """,
                    (
                        ncm,
                        display_text,
                        "chapter",
                        content[:200],
                        text_for_search,
                        ncm,
                        "chapter",
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO search_index (ncm, display_text, type, description)
                    SELECT ?, ?, ?, ?
                    WHERE NOT EXISTS (
                        SELECT 1 FROM search_index WHERE ncm = ? AND type = ? LIMIT 1
                    )
                    """,
                    (ncm, display_text, "chapter", text_for_search, ncm, "chapter"),
                )

        for codigo, chapter_num, descricao, _anchor_id in position_rows:
            ncm = codigo
            display_text = f"{codigo} - {descricao}"
            text_for_search = processor.process(descricao)
            if uses_indexed_content:
                conn.execute(
                    """
                    INSERT INTO search_index (ncm, display_text, type, description, indexed_content)
                    SELECT ?, ?, ?, ?, ?
                    WHERE NOT EXISTS (
                        SELECT 1 FROM search_index WHERE ncm = ? AND type = ? LIMIT 1
                    )
                    """,
                    (
                        ncm,
                        display_text,
                        "position",
                        descricao,
                        text_for_search,
                        ncm,
                        "position",
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO search_index (ncm, display_text, type, description)
                    SELECT ?, ?, ?, ?
                    WHERE NOT EXISTS (
                        SELECT 1 FROM search_index WHERE ncm = ? AND type = ? LIMIT 1
                    )
                    """,
                    (ncm, display_text, "position", text_for_search, ncm, "position"),
                )

        conn.commit()
    finally:
        conn.close()


def _ncm_sort_key(ncm: str) -> str:
    digits = "".join(ch for ch in ncm if ch.isdigit())
    return digits.ljust(12, "0")


def _seed_tipi_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tipi_chapters (
                codigo TEXT PRIMARY KEY,
                titulo TEXT NOT NULL,
                secao TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tipi_positions (
                ncm TEXT PRIMARY KEY,
                capitulo TEXT NOT NULL,
                descricao TEXT NOT NULL,
                aliquota TEXT,
                nivel INTEGER NOT NULL DEFAULT 0,
                parent_ncm TEXT,
                ncm_sort TEXT NOT NULL
            )
            """
        )
        tipi_columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info(tipi_positions)").fetchall()
        }
        if "parent_ncm" not in tipi_columns:
            conn.execute("ALTER TABLE tipi_positions ADD COLUMN parent_ncm TEXT")
        if "ncm_sort" not in tipi_columns:
            conn.execute("ALTER TABLE tipi_positions ADD COLUMN ncm_sort TEXT")
        if "nivel" not in tipi_columns:
            conn.execute(
                "ALTER TABLE tipi_positions ADD COLUMN nivel INTEGER NOT NULL DEFAULT 0"
            )

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tipi_cap_sort ON tipi_positions(capitulo, ncm_sort)"
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS tipi_fts USING fts5(
                ncm,
                capitulo,
                descricao,
                aliquota
            )
            """
        )

        chapter_rows = [
            ("01", "Animais vivos", "I"),
            ("39", "Plasticos e suas obras", "VII"),
            ("73", "Obras de ferro ou aco", "XV"),
            ("84", "Maquinas e aparelhos mecanicos", "XVI"),
            ("85", "Maquinas e aparelhos eletricos", "XVI"),
        ]
        conn.executemany(
            "INSERT OR IGNORE INTO tipi_chapters (codigo, titulo, secao) VALUES (?, ?, ?)",
            chapter_rows,
        )

        raw_positions = [
            ("01.01", "01", "Animais vivos da especie equina", "0", 1, None),
            (
                "39.24",
                "39",
                "Servicos de mesa e artigos de uso domestico",
                "0",
                1,
                None,
            ),
            ("3924.90", "39", "Outros artigos de plastico", "0", 2, "39.24"),
            (
                "3924.90.00",
                "39",
                "Outros artigos de plastico - especificado",
                "6.5",
                3,
                "3924.90",
            ),
            ("73.18", "73", "Parafusos, pinos e porcas", "5", 1, None),
            ("84.13", "84", "Bombas para liquidos", "0", 1, None),
            ("8413.11", "84", "Bombas para agua", "0", 2, "84.13"),
            ("8413.91", "84", "Partes de bombas", "0", 2, "84.13"),
            (
                "8413.91.90",
                "84",
                "Outras partes de bombas submersiveis",
                "0",
                3,
                "8413.91",
            ),
            ("84.14", "84", "Bombas de ar ou vacuo", "0", 1, None),
            ("85.17", "85", "Aparelhos de telefone e comunicacao", "0", 1, None),
            ("8517.13", "85", "Smartphones e telefones inteligentes", "0", 2, "85.17"),
            ("8517.13.00", "85", "Smartphones portateis", "0", 3, "8517.13"),
        ]

        position_rows = [
            (ncm, capitulo, descricao, aliquota, nivel, parent_ncm, _ncm_sort_key(ncm))
            for (ncm, capitulo, descricao, aliquota, nivel, parent_ncm) in raw_positions
        ]

        conn.executemany(
            """
            INSERT OR IGNORE INTO tipi_positions
                (ncm, capitulo, descricao, aliquota, nivel, parent_ncm, ncm_sort)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            position_rows,
        )

        conn.execute(
            """
            UPDATE tipi_positions
            SET ncm_sort = substr(REPLACE(ncm, '.', '') || '000000000000', 1, 12)
            WHERE ncm_sort IS NULL OR ncm_sort = ''
            """
        )

        for ncm, capitulo, descricao, aliquota, _, _, _ in position_rows:
            conn.execute(
                """
                INSERT INTO tipi_fts (ncm, capitulo, descricao, aliquota)
                SELECT ?, ?, ?, ?
                WHERE NOT EXISTS (
                    SELECT 1 FROM tipi_fts WHERE ncm = ? LIMIT 1
                )
                """,
                (ncm, capitulo, descricao, aliquota, ncm),
            )

        conn.commit()
    finally:
        conn.close()


@pytest.fixture(scope="session", autouse=True)
def ensure_test_databases():
    """
    Ensure minimal local databases exist for CI environments without committed *.db files.
    """
    # Test suite should be deterministic and local-file based.
    # Force SQLite mode even if developer .env points to PostgreSQL.
    settings.database.engine = "sqlite"
    settings.database.postgres_url = None
    settings.database.filename = "database/nesh.db"
    settings.database.tipi_filename = "database/tipi.db"

    # Disable Redis for unit/benchmark tests to avoid pool overhead in TestClient event loop.
    # Redis warm-cache benchmarks use subprocess (test_bench_ncm_lookup_redis_warm_restart)
    # which reads settings.json directly and is NOT affected by this override.
    settings.cache.enable_redis = False

    try:
        from backend.infrastructure.db_engine import close_db

        asyncio.run(close_db())
    except Exception:
        pass

    nesh_db_path = Path(CONFIG.db_path)
    tipi_db_path = Path(settings.database.tipi_path)

    if not _is_nesh_db_ready(nesh_db_path):
        _seed_nesh_db(nesh_db_path)

    if not _is_tipi_db_ready(tipi_db_path):
        _seed_tipi_db(tipi_db_path)


@pytest.fixture(scope="module")
def client():
    """
    Shared TestClient for all tests in the module.
    Uses 'module' scope to avoid spinning up app for every function.
    """
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def snapshot_data():
    """
    Load snapshot data once per session.
    """
    snapshot_path = str(SNAPSHOT_PATH)
    if not os.path.exists(snapshot_path):
        pytest.fail(f"Snapshot file not found at {snapshot_path}")

    with open(snapshot_path, "r", encoding="utf-8") as f:
        return json.load(f)
