
import pytest
import sqlite3
from backend.config import CONFIG

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
    query = "aparelho de som" # New query for this test
    
    def run_cold_search():
        response = client.get(f"/api/search?ncm={query}")
        assert response.status_code == 200
        
    # We run only 1 round to capture the 'Cold' behavior
    benchmark.pedantic(run_cold_search, rounds=1)
