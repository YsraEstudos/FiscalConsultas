from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.config.constants import SearchConfig
from backend.infrastructure.database import DatabaseAdapter
from backend.infrastructure.database_search import DatabaseSearchQueries


@pytest.mark.unit
def test_sanitize_fts_token_quotes_normal_token() -> None:
    assert DatabaseAdapter._sanitize_fts_token("motor") == '"motor"'


@pytest.mark.unit
def test_sanitize_fts_token_filters_reserved_operator() -> None:
    assert DatabaseAdapter._sanitize_fts_token("OR") == ""


@pytest.mark.unit
def test_sanitize_fts_token_removes_special_chars() -> None:
    assert DatabaseAdapter._sanitize_fts_token('"motor")*') == '"motor"'


@pytest.mark.unit
def test_sanitize_fts_token_rejects_multi_word_tokens() -> None:
    assert DatabaseAdapter._sanitize_fts_token("bomba hidraulica") == ""


class _FakeCursor:
    def __init__(self, rows=None):
        self.rows = rows or []

    async def fetchall(self):
        return list(self.rows)


class _FakeConn:
    def __init__(self):
        self.calls = []

    async def execute(self, query, params):
        self.calls.append((query, params))
        return _FakeCursor()


@pytest.mark.asyncio
async def test_execute_fts_query_rejects_negative_limit(monkeypatch):
    queries = DatabaseSearchQueries(SimpleNamespace(db_path="db.sqlite"))
    monkeypatch.setattr(
        queries,
        "_get_fts_schema_cached",
        AsyncMock(return_value={"available": True, "content_column": "content"}),
    )
    monkeypatch.setattr(
        queries,
        "_fts_rank_sql",
        lambda _schema: {"select": "rank AS rank", "order": "rank"},
    )

    with pytest.raises(ValueError, match="non-negative integer"):
        await queries._execute_fts_query(
            _FakeConn(),
            "motor",
            -1,
            raise_on_unavailable=True,
        )


@pytest.mark.asyncio
async def test_execute_fts_query_caps_limit_to_max(monkeypatch):
    queries = DatabaseSearchQueries(SimpleNamespace(db_path="db.sqlite"))
    fake_conn = _FakeConn()
    monkeypatch.setattr(
        queries,
        "_get_fts_schema_cached",
        AsyncMock(return_value={"available": True, "content_column": "content"}),
    )
    monkeypatch.setattr(
        queries,
        "_fts_rank_sql",
        lambda _schema: {"select": "rank AS rank", "order": "rank"},
    )

    await queries._execute_fts_query(
        fake_conn,
        "motor",
        SearchConfig.MAX_FTS_RESULTS + 25,
        raise_on_unavailable=True,
    )

    assert fake_conn.calls[0][1][1] == SearchConfig.MAX_FTS_RESULTS
