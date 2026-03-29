import sqlite3
import sys
from types import SimpleNamespace

import pytest

import test_support
from backend.config.settings import settings

pytestmark = pytest.mark.unit


class _ConnectionStub:
    def __init__(self, error: Exception | None = None):
        self.error = error
        self.executed_sql: list[str] = []

    def execute(self, sql: str):
        self.executed_sql.append(sql)
        if self.error is not None:
            raise self.error


def test_create_fts5_virtual_table_skips_when_fts5_is_unavailable(monkeypatch):
    monkeypatch.setattr(test_support, "_sqlite_supports_fts5", lambda: False)
    conn = _ConnectionStub()

    assert (
        test_support._create_fts5_virtual_table(conn, "search_index", "content")
        is False
    )
    assert conn.executed_sql == []


def test_create_fts5_virtual_table_handles_operational_error(monkeypatch):
    monkeypatch.setattr(test_support, "_sqlite_supports_fts5", lambda: True)
    conn = _ConnectionStub(sqlite3.OperationalError("no such module: fts5"))

    assert (
        test_support._create_fts5_virtual_table(conn, "search_index", "content")
        is False
    )
    assert conn.executed_sql == [
        "CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(content)"
    ]


def test_sqlite_test_environment_overrides_and_restores_services_filename():
    original_services_filename = settings.database.services_filename

    with test_support.sqlite_test_environment() as environment:
        assert settings.database.services_filename == str(environment.services_db_path)
        assert environment.env_overrides["DATABASE__SERVICES_FILENAME"] == str(
            environment.services_db_path
        )
        assert environment.services_db_path.exists()

    assert settings.database.services_filename == original_services_filename


def test_close_shared_db_engine_resets_tipi_pool_lock(monkeypatch):
    class _TipiServiceStub:
        _pool_lock = object()

        @classmethod
        async def close_all_pools(cls):
            return None

    monkeypatch.setitem(
        sys.modules,
        "backend.infrastructure.db_engine",
        SimpleNamespace(close_db=lambda: _async_noop()),
    )
    monkeypatch.setitem(
        sys.modules,
        "backend.services.tipi_service",
        SimpleNamespace(TipiService=_TipiServiceStub),
    )

    test_support._close_shared_db_engine()

    assert _TipiServiceStub._pool_lock is None


async def _async_noop():
    return None
