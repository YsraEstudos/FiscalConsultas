from types import SimpleNamespace

import pytest

from backend.server import app_lifecycle

pytestmark = pytest.mark.unit


class _FakeAlembicProcess:
    def __init__(
        self,
        returncode: int,
        stdout: bytes = b"",
        stderr: bytes = b"",
    ) -> None:
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr

    async def communicate(self):
        return self._stdout, self._stderr


@pytest.mark.asyncio
async def test_run_alembic_migrations_uses_current_python(monkeypatch):
    calls = []

    async def _fake_create_subprocess_exec(*args, **kwargs):
        calls.append((args, kwargs))
        return _FakeAlembicProcess(returncode=0, stdout=b"ok")

    monkeypatch.setattr(app_lifecycle.settings.database, "engine", "postgresql")
    monkeypatch.setattr(
        app_lifecycle.asyncio,
        "create_subprocess_exec",
        _fake_create_subprocess_exec,
        raising=False,
    )

    await app_lifecycle._run_alembic_migrations("C:/repo")

    args, kwargs = calls[0]
    assert args[:4] == (
        app_lifecycle.sys.executable,
        "-m",
        "alembic",
        "upgrade",
    )
    assert args[4] == "head"
    assert kwargs["cwd"] == "C:/repo"


@pytest.mark.asyncio
async def test_run_alembic_migrations_raises_when_alembic_fails(monkeypatch):
    async def _fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeAlembicProcess(returncode=1, stderr=b"database error")

    monkeypatch.setattr(app_lifecycle.settings.database, "engine", "postgresql")
    monkeypatch.setattr(
        app_lifecycle.asyncio,
        "create_subprocess_exec",
        _fake_create_subprocess_exec,
        raising=False,
    )

    with pytest.raises(RuntimeError, match="database error"):
        await app_lifecycle._run_alembic_migrations("C:/repo")


@pytest.mark.asyncio
async def test_init_nbs_service_falls_back_to_sqlite_when_postgres_has_no_nbs_data(
    monkeypatch,
):
    app = SimpleNamespace(state=SimpleNamespace())
    sqlite_service = object()

    async def _no_nbs_data():
        return False

    class _FakeNbsService:
        def __new__(cls):
            return sqlite_service

        @classmethod
        async def initializeNbsServiceWithPostgresRepository(cls):
            raise AssertionError("Postgres repository should not be initialized")

    monkeypatch.setattr(app_lifecycle.settings.database, "engine", "postgresql")
    monkeypatch.setattr(app_lifecycle, "_postgres_nbs_has_data", _no_nbs_data)
    monkeypatch.setattr(app_lifecycle, "NbsService", _FakeNbsService)

    await app_lifecycle._init_nbs_service(app)

    assert app.state.nbs_service is sqlite_service


@pytest.mark.asyncio
async def test_init_nbs_service_uses_postgres_when_nbs_data_exists(monkeypatch):
    app = SimpleNamespace(state=SimpleNamespace())
    postgres_service = object()

    async def _has_nbs_data():
        return True

    class _FakeNbsService:
        @classmethod
        async def initializeNbsServiceWithPostgresRepository(cls):
            return postgres_service

    monkeypatch.setattr(app_lifecycle.settings.database, "engine", "postgresql")
    monkeypatch.setattr(app_lifecycle, "_postgres_nbs_has_data", _has_nbs_data)
    monkeypatch.setattr(app_lifecycle, "NbsService", _FakeNbsService)

    await app_lifecycle._init_nbs_service(app)

    assert app.state.nbs_service is postgres_service
