import asyncio
import os
import subprocess
import sys
import time

import pytest
from test_support import sqlite_test_environment
from tests.shared_fixtures import (  # noqa: F401
    _cleanup_app_state,
    _reset_rate_limiters,
    client,
)
from backend.server.rate_limit import (
    ai_chat_rate_limiter,
    public_search_rate_limiter,
    services_detail_rate_limiter,
    services_search_rate_limiter,
    status_rate_limiter,
)

STARTUP_READY_MARKERS = (
    "Application startup complete",
    "Uvicorn running on",
)
DB_NOT_FOUND_MARKERS = (
    "Banco de dados não encontrado",
    "DB_NOT_FOUND",
)


@pytest.fixture(scope="session", autouse=True)
def _performance_environment():
    with sqlite_test_environment() as environment:
        yield environment


@pytest.fixture(autouse=True)
def _disable_rate_limits(monkeypatch):
    async def _allow(*_args, **_kwargs):  # NOSONAR
        return True, 0

    monkeypatch.setattr(ai_chat_rate_limiter, "consume", _allow)
    monkeypatch.setattr(status_rate_limiter, "consume", _allow)
    monkeypatch.setattr(public_search_rate_limiter, "consume", _allow)
    monkeypatch.setattr(services_search_rate_limiter, "consume", _allow)
    monkeypatch.setattr(services_detail_rate_limiter, "consume", _allow)
    yield


@pytest.fixture(scope="session")
def nesh_service(_performance_environment):
    """Instancia DatabaseAdapter/NeshService in-process (warm benchmarks)."""
    from backend.config import CONFIG
    from backend.data.glossary_manager import init_glossary
    from backend.infrastructure.database import DatabaseAdapter
    from backend.services.nesh_service import NeshService

    project_root = os.getcwd()
    init_glossary(project_root)

    db = DatabaseAdapter(CONFIG.db_path)
    svc = NeshService(db)
    try:
        yield svc
    finally:
        asyncio.run(db.close())


@pytest.fixture(scope="session")
def tipi_service(_performance_environment):
    from backend.services.tipi_service import TipiService

    svc = TipiService()
    try:
        yield svc
    finally:
        asyncio.run(svc.close())


@pytest.fixture(scope="session")
def cold_start_measure(_performance_environment):
    """Mede cold start sem depender de HTTP (lê stdout do processo até 'Servidor ... iniciado')."""

    def _measure(timeout_s: float = 60.0) -> float:
        proc = _start_cold_start_process(_performance_environment.env_overrides)
        start = time.perf_counter()
        try:
            return _measure_cold_start_time(proc, start, timeout_s)
        finally:
            _stop_process(proc)

    return _measure


def _build_cold_start_env(env_overrides: dict[str, str]) -> dict[str, str]:
    env = os.environ.copy()
    env["NESH_NO_BROWSER"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    env.update(env_overrides)
    return env


def _start_cold_start_process(env_overrides: dict[str, str]) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-u", "Nesh.py"],
        cwd=os.getcwd(),
        env=_build_cold_start_env(env_overrides),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )


def _read_process_line(proc: subprocess.Popen) -> str:
    if proc.stdout is None:
        return ""
    return proc.stdout.readline()


def _is_startup_complete(line: str) -> bool:
    return any(marker in line for marker in STARTUP_READY_MARKERS)


def _has_db_not_found_error(line: str) -> bool:
    return any(marker in line for marker in DB_NOT_FOUND_MARKERS)


def _raise_if_process_exited(proc: subprocess.Popen, output_lines: list[str]) -> None:
    if proc.poll() is None:
        return

    tail = "".join(output_lines[-30:])
    raise RuntimeError(
        f"Servidor encerrou durante cold start (exit={proc.returncode}).\n--- stdout tail ---\n{tail}"
    )


def _measure_cold_start_time(
    proc: subprocess.Popen, start: float, timeout_s: float
) -> float:
    output_lines: list[str] = []
    deadline = time.time() + timeout_s

    while time.time() < deadline:
        line = _read_process_line(proc)
        if not line:
            _raise_if_process_exited(proc, output_lines)
            continue

        output_lines.append(line)
        if _is_startup_complete(line):
            return (time.perf_counter() - start) * 1000.0
        if _has_db_not_found_error(line):
            raise RuntimeError(line.strip())

    raise RuntimeError(f"Timeout cold start ({timeout_s}s)")


def _stop_process(proc: subprocess.Popen) -> None:
    try:
        proc.terminate()
    except Exception:  # noqa: BLE001
        pass

    try:
        proc.wait(timeout=5)
    except Exception:  # noqa: BLE001
        pass
