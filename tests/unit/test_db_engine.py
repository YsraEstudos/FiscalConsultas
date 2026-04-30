from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.config.settings import settings
from backend.infrastructure import db_engine

pytestmark = pytest.mark.unit


def test_create_engine_uses_sqlite_defaults(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    original_engine = settings.database.engine
    original_url = settings.database.postgres_url
    original_debug = settings.features.debug_mode

    def fake_create_async_engine(db_url: str, **kwargs):
        calls.append((db_url, kwargs))
        return object()

    monkeypatch.setattr(db_engine, "create_async_engine", fake_create_async_engine)

    try:
        settings.database.engine = "sqlite"
        settings.database.postgres_url = None
        settings.features.debug_mode = False

        engine = db_engine._create_engine()
        assert engine is not None
        assert calls[0][0] == settings.database.async_url
        assert calls[0][1]["connect_args"] == {"check_same_thread": False}
    finally:
        settings.database.engine = original_engine
        settings.database.postgres_url = original_url
        settings.features.debug_mode = original_debug


def test_create_engine_uses_postgres_pool_settings(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    original_engine = settings.database.engine
    original_url = settings.database.postgres_url
    original_debug = settings.features.debug_mode

    def fake_create_async_engine(db_url: str, **kwargs):
        calls.append((db_url, kwargs))
        return object()

    monkeypatch.setattr(db_engine, "create_async_engine", fake_create_async_engine)

    try:
        settings.database.engine = "postgresql"
        settings.database.postgres_url = "postgresql+asyncpg://user:pass@host/db"
        settings.features.debug_mode = True

        engine = db_engine._create_engine()
        assert engine is not None
        assert calls[0][0] == settings.database.async_url
        assert calls[0][1]["pool_pre_ping"] is True
        assert calls[0][1]["pool_size"] == 10
        assert calls[0][1]["max_overflow"] == 20
        assert calls[0][1]["pool_recycle"] == 3600
        assert calls[0][1]["pool_timeout"] == 30
        assert calls[0][1]["echo"] is True
    finally:
        settings.database.engine = original_engine
        settings.database.postgres_url = original_url
        settings.features.debug_mode = original_debug


def test_get_engine_caches_singleton(monkeypatch) -> None:
    sentinel = object()
    calls = {"count": 0}

    def fake_create_engine():
        calls["count"] += 1
        return sentinel

    monkeypatch.setattr(db_engine, "_create_engine", fake_create_engine)
    db_engine._engine = None

    try:
        assert db_engine.get_engine() is sentinel
        assert db_engine.get_engine() is sentinel
        assert calls["count"] == 1
    finally:
        db_engine._engine = None


@pytest.mark.asyncio
async def test_get_session_and_get_db_use_tenant_context(monkeypatch) -> None:
    class _FakeSession:
        def __init__(self) -> None:
            self.executed = []
            self.commits = 0
            self.rollbacks = 0

        async def execute(self, statement, params):
            await asyncio.sleep(0)
            self.executed.append((statement, params))

        async def commit(self):
            await asyncio.sleep(0)
            self.commits += 1

        async def rollback(self):
            await asyncio.sleep(0)
            self.rollbacks += 1

    class _FakeSessionMaker:
        def __init__(self, session: _FakeSession) -> None:
            self.session = session

        def __call__(self):
            class _AsyncSessionContext:
                async def __aenter__(inner_self):
                    await asyncio.sleep(0)
                    return self.session

                async def __aexit__(inner_self, exc_type, exc, tb):
                    await asyncio.sleep(0)
                    return False

            return _AsyncSessionContext()

    original_engine_mode = settings.database.engine
    original_session_maker = db_engine.get_session_maker
    token = db_engine.tenant_context.set("tenant-123")
    fake_session = _FakeSession()

    try:
        settings.database.engine = "postgresql"
        monkeypatch.setattr(
            db_engine, "get_session_maker", lambda: _FakeSessionMaker(fake_session)
        )

        async with db_engine.get_session() as session:
            assert session is fake_session

        assert fake_session.commits == 1
        assert fake_session.rollbacks == 0
        assert len(fake_session.executed) == 1

        yielded_sessions = []
        async for session in db_engine.get_db():
            yielded_sessions.append(session)

        assert yielded_sessions == [fake_session]
    finally:
        settings.database.engine = original_engine_mode
        db_engine.get_session_maker = original_session_maker
        db_engine.tenant_context.reset(token)


@pytest.mark.asyncio
async def test_close_db_disposes_cached_engine() -> None:
    fake_engine = SimpleNamespace(dispose=AsyncMock())
    db_engine._engine = fake_engine

    await db_engine.close_db()

    assert db_engine._engine is None
    fake_engine.dispose.assert_awaited_once()
