from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest

from backend.config.exceptions import DatabaseError
from backend.infrastructure.database import ConnectionPool, DatabaseAdapter

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_create_connection_wraps_connect_failures(monkeypatch):
    pool = ConnectionPool("missing.db")

    async def _fail_connect(_db_path):
        raise RuntimeError("connect exploded")

    monkeypatch.setattr(
        "backend.infrastructure.database.aiosqlite.connect", _fail_connect
    )
    monkeypatch.setattr(
        "backend.infrastructure.database.logger.error", lambda *_args, **_kwargs: None
    )

    with pytest.raises(
        DatabaseError, match="Falha ao conectar ao banco: connect exploded"
    ):
        await pool._create_connection()


class _ExplodingFtsConnection:
    async def execute(self, *_args, **_kwargs):
        raise RuntimeError("fts introspection exploded")


@pytest.mark.asyncio
async def test_detect_fts_schema_returns_unavailable_when_introspection_fails(
    monkeypatch,
):
    adapter = DatabaseAdapter("database/nesh.db")
    monkeypatch.setattr(
        "backend.infrastructure.database.logger.error", lambda *_args, **_kwargs: None
    )

    schema = await adapter._detect_fts_schema(_ExplodingFtsConnection())

    assert schema["available"] is False
    assert "Falha ao inspecionar schema FTS" in schema["reason"]
    assert "fts introspection exploded" in schema["reason"]


class _ExplodingChapterNotesConnection:
    async def execute(self, *_args, **_kwargs):
        raise RuntimeError("chapter_notes exploded")


@pytest.mark.asyncio
async def test_get_chapter_notes_columns_returns_empty_set_on_error(monkeypatch):
    adapter = DatabaseAdapter("database/nesh.db")
    monkeypatch.setattr(
        "backend.infrastructure.database.logger.warning",
        lambda *_args, **_kwargs: None,
    )

    columns = await adapter._get_chapter_notes_columns(
        _ExplodingChapterNotesConnection()
    )

    assert columns == set()


class _FailingNearConnection:
    def __init__(self):
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def execute(self, query, params):
        self.calls.append((query, params))
        raise RuntimeError("near query exploded")


@pytest.mark.asyncio
async def test_fts_search_near_returns_empty_list_when_query_execution_fails(
    monkeypatch,
):
    adapter = DatabaseAdapter("database/nesh.db")
    conn = _FailingNearConnection()

    @asynccontextmanager
    async def _fake_connection():
        yield conn

    _fake_schema = AsyncMock(
        return_value={
            "available": True,
            "content_column": "indexed_content",
            "supports_rank": True,
        }
    )

    monkeypatch.setattr(adapter, "get_connection", _fake_connection)
    monkeypatch.setattr(adapter, "_get_fts_schema_cached", _fake_schema)
    monkeypatch.setattr(
        "backend.infrastructure.database.logger.debug", lambda *_args, **_kwargs: None
    )

    results = await adapter.fts_search_near(["motor", "bomba"], distance=5, limit=3)

    assert results == []
    assert len(conn.calls) == 1
    assert conn.calls[0][1] == ('NEAR("motor" "bomba", 5)', 3)
