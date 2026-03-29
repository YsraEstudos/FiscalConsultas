import asyncio
import logging
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterator, Protocol

LOGGER = logging.getLogger(__name__)

_COUNT_QUERIES: dict[str, str] = {
    "chapters": "SELECT COUNT(*) FROM chapters",
    "search_index": "SELECT COUNT(*) FROM search_index",
    "tipi_positions": "SELECT COUNT(*) FROM tipi_positions",
}


class _SqlExecutor(Protocol):
    def execute(self, sql: str) -> object: ...


@dataclass
class SQLiteTestEnvironment:
    temporary_directory: TemporaryDirectory[str]
    nesh_db_path: Path
    tipi_db_path: Path
    services_db_path: Path
    original_engine: str
    original_postgres_url: str | None
    original_filename: str
    original_tipi_filename: str
    original_services_filename: str
    original_redis_enabled: bool

    @property
    def env_overrides(self) -> dict[str, str]:
        return {
            "DATABASE__ENGINE": "sqlite",
            "DATABASE__FILENAME": str(self.nesh_db_path),
            "DATABASE__TIPI_FILENAME": str(self.tipi_db_path),
            "DATABASE__SERVICES_FILENAME": str(self.services_db_path),
            "CACHE__ENABLE_REDIS": "false",
        }

    def apply(self) -> None:
        from backend.config.settings import settings

        _close_shared_db_engine()
        settings.database.engine = "sqlite"
        settings.database.postgres_url = None
        settings.database.filename = str(self.nesh_db_path)
        settings.database.tipi_filename = str(self.tipi_db_path)
        settings.database.services_filename = str(self.services_db_path)
        settings.cache.enable_redis = False

    def restore(self) -> None:
        from backend.config.settings import settings

        _close_shared_db_engine()
        settings.database.engine = self.original_engine
        settings.database.postgres_url = self.original_postgres_url
        settings.database.filename = self.original_filename
        settings.database.tipi_filename = self.original_tipi_filename
        settings.database.services_filename = self.original_services_filename
        settings.cache.enable_redis = self.original_redis_enabled
        _close_shared_db_engine()

    def cleanup(self) -> None:
        self.temporary_directory.cleanup()


def _close_shared_db_engine() -> None:
    try:
        from backend.infrastructure.db_engine import close_db

        asyncio.run(close_db())
    except Exception as exc:
        LOGGER.debug("Failed to close shared DB engine during test bootstrap: %s", exc)

    try:
        from backend.services.tipi_service import TipiService

        try:
            asyncio.run(TipiService.close_all_pools())
        finally:
            TipiService._pool_lock = None
    except Exception as exc:
        LOGGER.debug("Failed to close TIPI pools during test bootstrap: %s", exc)


@lru_cache(maxsize=1)
def _sqlite_supports_fts5() -> bool:
    try:
        conn = sqlite3.connect(":memory:")
        try:
            conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS fts5_probe USING fts5(x)")
        finally:
            conn.close()
    except sqlite3.OperationalError:
        return False
    return True


def _create_fts5_virtual_table(
    conn: _SqlExecutor, table_name: str, columns_sql: str
) -> bool:
    if not _sqlite_supports_fts5():
        LOGGER.debug("Skipping FTS5 table %s: SQLite build lacks FTS5", table_name)
        return False

    try:
        conn.execute(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS {table_name} USING fts5({columns_sql})"
        )
    except sqlite3.OperationalError as exc:
        LOGGER.debug("Skipping FTS5 table %s: %s", table_name, exc)
        return False
    return True


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table_name,),
    )
    return cur.fetchone() is not None


def _count_rows(conn: sqlite3.Connection, table_name: str) -> int:
    query = _COUNT_QUERIES.get(table_name)
    if not query:
        return 0

    try:
        cur = conn.execute(query)
        return int(cur.fetchone()[0])
    except sqlite3.Error:
        return 0


def _is_nesh_db_ready(db_path: Path) -> bool:
    if not db_path.exists():
        return False

    try:
        conn = sqlite3.connect(db_path)
        try:
            required_tables = {"chapters", "positions", "chapter_notes"}
            if _sqlite_supports_fts5():
                required_tables.add("search_index")
            if not all(_table_exists(conn, table) for table in required_tables):
                return False
            if _count_rows(conn, "chapters") < 97:
                return False
            if (
                _table_exists(conn, "search_index")
                and _count_rows(conn, "search_index") < 1
            ):
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
            required_tables = {"tipi_chapters", "tipi_positions"}
            if _sqlite_supports_fts5():
                required_tables.add("tipi_fts")
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


def _is_services_db_ready(db_path: Path) -> bool:
    if not db_path.exists():
        return False

    try:
        conn = sqlite3.connect(db_path)
        try:
            required_tables = {"catalog_metadata", "nbs_items", "nebs_entries"}
            if not all(_table_exists(conn, table) for table in required_tables):
                return False

            nbs_columns = {
                row[1]
                for row in conn.execute("PRAGMA table_info(nbs_items)").fetchall()
            }
            nebs_columns = {
                row[1]
                for row in conn.execute("PRAGMA table_info(nebs_entries)").fetchall()
            }
            if not {"code_clean", "description_normalized", "has_nebs"}.issubset(
                nbs_columns
            ):
                return False
            if not {"title_normalized", "body_normalized", "updated_at"}.issubset(
                nebs_columns
            ):
                return False
            return True
        finally:
            conn.close()
    except sqlite3.Error:
        return False


def _build_nesh_seed_rows() -> tuple[list[tuple], list[tuple], list[tuple]]:
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

    return chapter_rows, note_rows, position_rows


def _ensure_column(
    conn: sqlite3.Connection, table_name: str, column_name: str, ddl: str
) -> None:
    columns = {
        row[1] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    if column_name not in columns:
        conn.execute(ddl)


def _create_nesh_core_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chapters (
            chapter_num TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            raw_text TEXT,
            tenant_id TEXT,
            search_vector TEXT
        )
        """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS positions (
            codigo TEXT PRIMARY KEY,
            chapter_num TEXT NOT NULL,
            descricao TEXT,
            anchor_id TEXT,
            tenant_id TEXT,
            search_vector TEXT
        )
        """)
    _ensure_column(
        conn,
        "positions",
        "anchor_id",
        "ALTER TABLE positions ADD COLUMN anchor_id TEXT",
    )
    conn.execute("""
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
        """)
    _ensure_column(
        conn,
        "chapter_notes",
        "parsed_notes_json",
        "ALTER TABLE chapter_notes ADD COLUMN parsed_notes_json TEXT",
    )


def _create_nesh_tenant_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            subscription_plan TEXT NOT NULL DEFAULT 'free'
        )
        """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            full_name TEXT,
            tenant_id TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        )
        """)
    conn.execute("""
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
        """)
    for index_sql in (
        "CREATE INDEX IF NOT EXISTS ix_users_tenant_id ON users(tenant_id)",
        "CREATE INDEX IF NOT EXISTS ix_subscriptions_tenant_id ON subscriptions(tenant_id)",
        "CREATE INDEX IF NOT EXISTS ix_subscriptions_provider ON subscriptions(provider)",
        "CREATE INDEX IF NOT EXISTS ix_subscriptions_provider_customer_id ON subscriptions(provider_customer_id)",
        "CREATE INDEX IF NOT EXISTS ix_subscriptions_provider_subscription_id ON subscriptions(provider_subscription_id)",
        "CREATE INDEX IF NOT EXISTS ix_subscriptions_provider_payment_id ON subscriptions(provider_payment_id)",
        "CREATE INDEX IF NOT EXISTS ix_subscriptions_status ON subscriptions(status)",
    ):
        conn.execute(index_sql)


def _prepare_nesh_search_index(conn: sqlite3.Connection) -> tuple[bool, bool]:
    search_index_available = _table_exists(conn, "search_index")
    if not search_index_available:
        search_index_available = _create_fts5_virtual_table(
            conn,
            "search_index",
            """
            ncm,
            display_text,
            type,
            description,
            indexed_content
            """,
        )

    if not search_index_available:
        return False, False

    fts_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(search_index)").fetchall()
    }
    return True, "indexed_content" in fts_columns


def _seed_nesh_base_rows(
    conn: sqlite3.Connection,
    chapter_rows: list[tuple],
    note_rows: list[tuple],
    position_rows: list[tuple],
) -> None:
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
    conn.execute("""
        UPDATE positions
        SET anchor_id = 'pos-' || REPLACE(codigo, '.', '-')
        WHERE anchor_id IS NULL OR anchor_id = ''
        """)


def _insert_search_index_entry(
    conn: sqlite3.Connection,
    *,
    ncm: str,
    display_text: str,
    entry_type: str,
    description: str,
    text_for_search: str,
    uses_indexed_content: bool,
) -> None:
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
                entry_type,
                description,
                text_for_search,
                ncm,
                entry_type,
            ),
        )
        return

    conn.execute(
        """
        INSERT INTO search_index (ncm, display_text, type, description)
        SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (
            SELECT 1 FROM search_index WHERE ncm = ? AND type = ? LIMIT 1
        )
        """,
        (ncm, display_text, entry_type, text_for_search, ncm, entry_type),
    )


def _seed_nesh_search_index(
    conn: sqlite3.Connection,
    processor,
    chapter_rows: list[tuple],
    position_rows: list[tuple],
    *,
    uses_indexed_content: bool,
) -> None:
    for chapter_num, content in chapter_rows:
        _insert_search_index_entry(
            conn,
            ncm=chapter_num,
            display_text=f"Capitulo {chapter_num}",
            entry_type="chapter",
            description=content[:200],
            text_for_search=processor.process(content),
            uses_indexed_content=uses_indexed_content,
        )

    for codigo, _chapter_num, descricao, _anchor_id in position_rows:
        _insert_search_index_entry(
            conn,
            ncm=codigo,
            display_text=f"{codigo} - {descricao}",
            entry_type="position",
            description=descricao,
            text_for_search=processor.process(descricao),
            uses_indexed_content=uses_indexed_content,
        )


def _seed_services_db(db_path: Path) -> None:
    from backend.config.services_db_schema import (
        CATALOG_METADATA_CREATE_SQL,
        NBS_ITEMS_CREATE_SQL,
        NEBS_ENTRIES_CREATE_SQL,
        NEBS_ENTRIES_FTS_CREATE_SQL,
        SERVICES_INDEXES_SQL,
    )

    db_path.parent.mkdir(parents=True, exist_ok=True)
    if not db_path.exists():
        db_path.touch()

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(CATALOG_METADATA_CREATE_SQL)
        conn.execute(NBS_ITEMS_CREATE_SQL)
        conn.execute(NEBS_ENTRIES_CREATE_SQL)
        for index_sql in SERVICES_INDEXES_SQL:
            conn.execute(index_sql)

        if _sqlite_supports_fts5():
            try:
                conn.execute(NEBS_ENTRIES_FTS_CREATE_SQL)
            except sqlite3.OperationalError as exc:
                LOGGER.debug("Skipping services FTS table: %s", exc)

        conn.execute("""
            INSERT OR REPLACE INTO catalog_metadata (key, value)
            VALUES ('seeded_for_tests', 'true')
            """)
        conn.execute(
            """
            INSERT OR IGNORE INTO nbs_items
                (code, code_clean, description, description_normalized, parent_code, level, source_order, sort_path, has_nebs)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "1.01",
                "101",
                "Servicos de construcao",
                "servicos de construcao",
                None,
                1,
                1,
                "0001",
                1,
            ),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO nebs_entries
                (code, code_clean, title, title_normalized, body_text, body_markdown, body_normalized,
                 section_title, page_start, page_end, parser_status, parse_warnings, source_hash, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "1.01",
                "101",
                "Servicos de construcao",
                "servicos de construcao",
                "Servico de referencia para testes.",
                "Servico de referencia para testes.",
                "servico de referencia para testes",
                "SECAO I",
                1,
                1,
                "trusted",
                None,
                "test-hash",
                "2026-01-01T00:00:00+00:00",
            ),
        )
        if _table_exists(conn, "nebs_entries_fts"):
            conn.execute(
                """
                INSERT INTO nebs_entries_fts (code, title, body_text, section_title)
                SELECT ?, ?, ?, ?
                WHERE NOT EXISTS (
                    SELECT 1 FROM nebs_entries_fts WHERE code = ? LIMIT 1
                )
                """,
                (
                    "1.01",
                    "Servicos de construcao",
                    "Servico de referencia para testes.",
                    "SECAO I",
                    "1.01",
                ),
            )

        conn.commit()
    finally:
        conn.close()


def _seed_nesh_db(db_path: Path) -> None:
    from backend.config import CONFIG
    from backend.utils.text_processor import NeshTextProcessor

    db_path.parent.mkdir(parents=True, exist_ok=True)
    if not db_path.exists():
        db_path.touch()

    processor = NeshTextProcessor(list(CONFIG.stopwords))
    chapter_rows, note_rows, position_rows = _build_nesh_seed_rows()

    conn = sqlite3.connect(db_path)
    try:
        _create_nesh_core_schema(conn)
        _create_nesh_tenant_schema(conn)
        search_index_available, uses_indexed_content = _prepare_nesh_search_index(conn)
        _seed_nesh_base_rows(conn, chapter_rows, note_rows, position_rows)
        if search_index_available:
            _seed_nesh_search_index(
                conn,
                processor,
                chapter_rows,
                position_rows,
                uses_indexed_content=uses_indexed_content,
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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tipi_chapters (
                codigo TEXT PRIMARY KEY,
                titulo TEXT NOT NULL,
                secao TEXT
            )
            """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tipi_positions (
                ncm TEXT PRIMARY KEY,
                capitulo TEXT NOT NULL,
                descricao TEXT NOT NULL,
                aliquota TEXT,
                nivel INTEGER NOT NULL DEFAULT 0,
                parent_ncm TEXT,
                ncm_sort TEXT NOT NULL
            )
            """)
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
        tipi_fts_available = _table_exists(conn, "tipi_fts")
        if not tipi_fts_available:
            tipi_fts_available = _create_fts5_virtual_table(
                conn,
                "tipi_fts",
                """
                ncm,
                capitulo,
                descricao,
                aliquota
                """,
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

        conn.execute("""
            UPDATE tipi_positions
            SET ncm_sort = substr(REPLACE(ncm, '.', '') || '000000000000', 1, 12)
            WHERE ncm_sort IS NULL OR ncm_sort = ''
            """)

        if tipi_fts_available:
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


def _build_sqlite_test_environment() -> SQLiteTestEnvironment:
    from backend.config.settings import settings

    temporary_directory = TemporaryDirectory(prefix="pytest-sqlite-")
    temporary_root = Path(temporary_directory.name)
    nesh_db_path = temporary_root / "nesh.db"
    tipi_db_path = temporary_root / "tipi.db"
    services_db_path = temporary_root / "services.db"

    if not _is_nesh_db_ready(nesh_db_path):
        _seed_nesh_db(nesh_db_path)

    if not _is_tipi_db_ready(tipi_db_path):
        _seed_tipi_db(tipi_db_path)

    if not _is_services_db_ready(services_db_path):
        _seed_services_db(services_db_path)

    return SQLiteTestEnvironment(
        temporary_directory=temporary_directory,
        nesh_db_path=nesh_db_path,
        tipi_db_path=tipi_db_path,
        services_db_path=services_db_path,
        original_engine=settings.database.engine,
        original_postgres_url=settings.database.postgres_url,
        original_filename=settings.database.filename,
        original_tipi_filename=settings.database.tipi_filename,
        original_services_filename=settings.database.services_filename,
        original_redis_enabled=settings.cache.enable_redis,
    )


@contextmanager
def sqlite_test_environment() -> Iterator[SQLiteTestEnvironment]:
    environment = _build_sqlite_test_environment()
    environment.apply()
    try:
        yield environment
    finally:
        environment.restore()
        environment.cleanup()


def configure_sqlite_test_environment() -> SQLiteTestEnvironment:
    environment = _build_sqlite_test_environment()
    environment.apply()
    return environment


def reset_all_rate_limiters() -> None:
    from backend.server import rate_limit

    for limiter_name in (
        "ai_chat_rate_limiter",
        "public_search_rate_limiter",
        "search_rate_limiter",
        "status_rate_limiter",
        "services_search_rate_limiter",
        "services_detail_rate_limiter",
    ):
        limiter = getattr(rate_limit, limiter_name, None)
        if limiter is not None:
            limiter.reset()
