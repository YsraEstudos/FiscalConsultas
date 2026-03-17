import sqlite3

import pytest

import test_support

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
