import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

from backend.config.services_db_schema import NBS_ITEMS_CREATE_SQL
from backend.config.settings import settings as app_settings
from backend.utils.nebs_parser import NebsParseOutcome, ParsedNebsEntry

pytestmark = pytest.mark.unit


def _load_setup_nebs_database():
    object.__setattr__(app_settings.database, "services_path", "database/services.db")
    sys.modules.pop("scripts.setup_nebs_database", None)
    return importlib.import_module("scripts.setup_nebs_database")


def _load_setup_nbs_database():
    object.__setattr__(app_settings.database, "services_path", "database/services.db")
    sys.modules.pop("scripts.setup_nbs_database", None)
    return importlib.import_module("scripts.setup_nbs_database")


def _create_catalog_metadata_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE catalog_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )


def test_write_metadata_generates_string_timestamp_independent_of_entries():
    setup_nebs_database = _load_setup_nebs_database()
    conn = sqlite3.connect(":memory:")
    _create_catalog_metadata_table(conn)

    outcome = NebsParseOutcome(
        entries=[
            ParsedNebsEntry(
                code="1.01",
                code_clean="101",
                title="Titulo",
                title_normalized="titulo",
                body_text="Corpo confiavel o bastante para passar nas regras.",
                body_markdown=None,
                body_normalized="corpo confiavel o bastante para passar nas regras",
                section_title="SEÇÃO I",
                page_start=1,
                page_end=1,
                parser_status="trusted",
                parse_warnings=None,
                source_hash="hash-antigo",
                updated_at="1999-01-01T00:00:00+00:00",
            )
        ],
        counts={"trusted": 1, "suspect": 0, "rejected": 0},
    )

    setup_nebs_database._write_metadata(conn, outcome, "hash-atual")

    rows = dict(conn.execute("SELECT key, value FROM catalog_metadata").fetchall())
    conn.close()

    assert rows["nebs_source_hash"] == "hash-atual"
    assert rows["nebs_updated_at"] != "1999-01-01T00:00:00+00:00"
    assert isinstance(rows["nebs_updated_at"], str)
    assert rows["nebs_updated_at"].endswith("+00:00")


def test_write_metadata_handles_empty_entries():
    setup_nebs_database = _load_setup_nebs_database()
    conn = sqlite3.connect(":memory:")
    _create_catalog_metadata_table(conn)

    outcome = NebsParseOutcome(
        entries=[], counts={"trusted": 0, "suspect": 1, "rejected": 2}
    )

    setup_nebs_database._write_metadata(conn, outcome, "hash-vazio")

    rows = dict(conn.execute("SELECT key, value FROM catalog_metadata").fetchall())
    conn.close()

    assert rows["nebs_trusted_count"] == "0"
    assert rows["nebs_suspect_count"] == "1"
    assert rows["nebs_rejected_count"] == "2"
    assert rows["nebs_updated_at"]


def test_ensure_schema_drops_stale_fts_table_when_nebs_schema_is_old():
    setup_nebs_database = _load_setup_nebs_database()
    conn = sqlite3.connect(":memory:")
    conn.execute(NBS_ITEMS_CREATE_SQL)
    conn.execute("CREATE TABLE nebs_entries (code TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE nebs_entries_fts (legacy TEXT)")

    setup_nebs_database._ensure_schema(conn)

    entry_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(nebs_entries)").fetchall()
    }
    fts_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'nebs_entries_fts'"
    ).fetchone()[0]
    conn.close()

    assert "code_clean" in entry_columns
    assert "source_hash" in entry_columns
    assert "VIRTUAL TABLE" in fts_sql
    assert "body_text" in fts_sql


def test_confirm_destructive_schema_reset_skips_prompt_in_ci(monkeypatch, capsys):
    setup_nbs_database = _load_setup_nbs_database()
    db_file = Path("existing.db")

    monkeypatch.setenv("CI", "true")
    monkeypatch.setattr(setup_nbs_database.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(Path, "exists", lambda _self: True)

    assert setup_nbs_database._confirm_destructive_schema_reset(db_file) is True
    assert "AVISO:" in capsys.readouterr().out


def test_confirm_destructive_schema_reset_cancels_on_negative_tty_answer(
    monkeypatch, capsys
):
    setup_nbs_database = _load_setup_nbs_database()
    db_file = Path("existing.db")

    monkeypatch.delenv("CI", raising=False)
    monkeypatch.setattr(setup_nbs_database.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(Path, "exists", lambda _self: True)
    monkeypatch.setattr("builtins.input", lambda _prompt: "n")

    assert setup_nbs_database._confirm_destructive_schema_reset(db_file) is False
    assert "AVISO:" in capsys.readouterr().out


def test_confirm_destructive_schema_reset_accepts_affirmative_tty_answer(monkeypatch):
    setup_nbs_database = _load_setup_nbs_database()
    db_file = Path("existing.db")

    monkeypatch.delenv("CI", raising=False)
    monkeypatch.setattr(setup_nbs_database.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(Path, "exists", lambda _self: True)
    monkeypatch.setattr("builtins.input", lambda _prompt: "yes")

    assert setup_nbs_database._confirm_destructive_schema_reset(db_file) is True
