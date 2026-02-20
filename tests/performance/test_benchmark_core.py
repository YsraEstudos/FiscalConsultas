import os
import socket
import subprocess
import sys
import time
from urllib.parse import urlparse

import httpx
import pytest
import sqlite3
from backend.config import CONFIG
from backend.config.settings import settings

# --- NCM Search Benchmarks ---


@pytest.mark.benchmark(group="core_search")
def test_bench_ncm_lookup_simple(benchmark, client):
    """
    Benchmark simple 4-digit NCM lookup.
    Example: 8517 (Telefonia) - High traffic.
    """

    def run_lookup():
        response = client.get("/api/search?ncm=8517")
        assert response.status_code == 200

    benchmark(run_lookup)


@pytest.mark.benchmark(group="core_search")
def test_bench_ncm_lookup_complex(benchmark, client):
    """
    Benchmark specific position lookup.
    Example: 8471.30 (Data processing machines).
    """

    def run_lookup():
        response = client.get("/api/search?ncm=8471.30")
        assert response.status_code == 200

    benchmark(run_lookup)


# --- FTS Benchmarks ---


@pytest.mark.benchmark(group="fts_search")
def test_bench_fts_simple(benchmark, client):
    """
    Benchmark simple text search (likely Tier 1 or 2).
    """

    def run_search():
        response = client.get("/api/search?ncm=parafusos")
        assert response.status_code == 200

    benchmark(run_search)


@pytest.mark.benchmark(group="fts_search")
def test_bench_fts_complex(benchmark, client):
    """
    Benchmark complex text search (multiple terms, likely FTS logic intensive).
    """

    def run_search():
        response = client.get("/api/search?ncm=maquina de lavar roupa")
        assert response.status_code == 200

    benchmark(run_search)


# --- Database Overhead Benchmarks ---


@pytest.mark.benchmark(group="db_overhead")
def test_bench_raw_sqlite_query(benchmark):
    """
    Benchmark raw SQLite performance to measure API overhead.
    """
    conn = sqlite3.connect(CONFIG.db_path)

    def run_query():
        cursor = conn.cursor()
        cursor.execute("SELECT content FROM chapters WHERE chapter_num = '85'")
        cursor.fetchone()

    benchmark(run_query)
    conn.close()


# --- Cold vs Warm Comparisons ---


@pytest.mark.benchmark(group="boot_performance")
def test_bench_cold_start_server(benchmark, cold_start_measure):
    """
    Benchmark full server boot time (Cold Start).
    Measures time from 'python Nesh.py' to 'Servidor iniciado'.
    """

    def run_boot():
        # cold_start_measure is a fixture that returns the time in ms
        boot_time_ms = cold_start_measure(timeout_s=30.0)
        assert boot_time_ms > 0
        return boot_time_ms

    # We use a custom timer since the fixture already does the timing
    # benchmark.pedantic runs this 5 times by default
    benchmark.pedantic(run_boot, rounds=3, iterations=1)


@pytest.mark.benchmark(group="caching_performance")
def test_bench_search_cold_vs_warm(benchmark, client):
    """
    Compare first search (cold) vs subsequent cached searches (warm).
    Query: 'bombas centrifugas' (specific enough to be 'cold' on first run in this session).
    """
    query = "bombas centrifugas"

    # We want to measure the VERY FIRST call separately from subsequent ones if possible,
    # but pytest-benchmark usually averages.
    # To show the difference, we can create two distinct tests or use a setup.

    def run_warm_search():
        response = client.get(f"/api/search?ncm={query}")
        assert response.status_code == 200

    # Warm run (cached)
    benchmark.pedantic(run_warm_search, rounds=20, warmup_rounds=1)


@pytest.mark.benchmark(group="caching_performance")
def test_bench_search_initial_cold(benchmark, client):
    """
    Measures the initial 'Cold' search performance.
    Note: Each round here will likely be 'warm' after the first iteration
    unless we restart the app, but we run it to get a baseline 'first hit' metric.
    """
    query = "aparelho de som"  # New query for this test

    def run_cold_search():
        response = client.get(f"/api/search?ncm={query}")
        assert response.status_code == 200

    # We run only 1 round to capture the 'Cold' behavior
    benchmark.pedantic(run_cold_search, rounds=1)


def _redis_is_available() -> bool:
    if not settings.cache.enable_redis:
        return False
    parsed = urlparse(settings.cache.redis_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    try:
        with socket.create_connection((host, port), timeout=1.5):
            return True
    except OSError:
        return False


def _start_server() -> subprocess.Popen:
    env = os.environ.copy()
    env["NESH_NO_BROWSER"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    env["NESH_RELOAD"] = "0"

    proc = subprocess.Popen(
        [sys.executable, "-u", "Nesh.py"],
        cwd=os.getcwd(),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )

    deadline = time.time() + 30.0
    while time.time() < deadline:
        line = proc.stdout.readline() if proc.stdout else ""
        if not line:
            if proc.poll() is not None:
                raise RuntimeError(
                    f"Servidor encerrou no startup (exit={proc.returncode})"
                )
            continue

        if "Application startup complete" in line or "Uvicorn running on" in line:
            _wait_server_http_ready(proc, timeout_s=max(1.0, deadline - time.time()))
            return proc

    try:
        proc.terminate()
    except Exception:
        pass
    raise RuntimeError("Timeout ao iniciar servidor")


def _wait_server_http_ready(proc: subprocess.Popen, timeout_s: float = 15.0) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(
                f"Servidor encerrou antes de ficar pronto (exit={proc.returncode})"
            )

        try:
            resp = httpx.get("http://127.0.0.1:8000/api/status", timeout=1.5)
            if resp.status_code == 200:
                return
        except httpx.HTTPError:
            pass

        time.sleep(0.1)

    raise RuntimeError("Timeout aguardando readiness HTTP em /api/status")


def _stop_server(proc: subprocess.Popen) -> None:
    try:
        proc.terminate()
    except Exception:
        return
    try:
        proc.wait(timeout=5)
    except Exception:
        pass


@pytest.mark.benchmark(group="caching_performance")
def test_bench_ncm_lookup_redis_warm_restart(benchmark):
    """
    Benchmark NCM lookup com Redis warm e L1 vazio (via restart).
    Warm Redis em um processo, reinicia o app e mede o primeiro hit.
    """
    if not _redis_is_available():
        pytest.skip("Redis indisponivel ou desativado")

    def warm_redis():
        proc = _start_server()
        try:
            resp = httpx.get("http://127.0.0.1:8000/api/search?ncm=8517", timeout=10.0)
            assert resp.status_code == 200
        finally:
            _stop_server(proc)

    warm_redis()

    def run_lookup():
        proc = _start_server()
        try:
            start = time.perf_counter()
            resp = httpx.get("http://127.0.0.1:8000/api/search?ncm=8517", timeout=10.0)
            end = time.perf_counter()
            assert resp.status_code == 200
            return (end - start) * 1000.0
        finally:
            _stop_server(proc)

    benchmark.pedantic(run_lookup, rounds=5, iterations=1)
