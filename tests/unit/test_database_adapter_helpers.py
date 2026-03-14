import pytest

from backend.infrastructure.database import DatabaseAdapter


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
def test_sanitize_fts_token_keeps_first_word_only() -> None:
    assert DatabaseAdapter._sanitize_fts_token("bomba hidraulica") == '"bomba"'


@pytest.mark.asyncio
async def test_fts_search_near_returns_empty_when_query_execution_fails(monkeypatch):
    adapter = DatabaseAdapter("tests/fixtures/unused.db")

    class _FailingConnection:
        async def execute(self, *_args, **_kwargs):
            raise RuntimeError("fts boom")

    class _ConnectionContext:
        async def __aenter__(self):
            return _FailingConnection()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(adapter, "get_connection", lambda: _ConnectionContext())
    monkeypatch.setattr(
        adapter,
        "_get_fts_schema_cached",
        lambda _conn: {"available": True, "content_column": "description"},
    )
    monkeypatch.setattr(
        adapter,
        "_fts_rank_sql",
        lambda _schema: {"select": "rank", "order": "rank"},
    )
    monkeypatch.setattr(
        "backend.infrastructure.database.logger.debug",
        lambda *_args, **_kwargs: None,
    )

    results = await adapter.fts_search_near(["motor", "bomba"], distance=5, limit=10)

    assert results == []
