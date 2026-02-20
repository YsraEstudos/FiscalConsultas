import pytest

# --- TIPI Search Benchmarks ---


@pytest.mark.benchmark(group="tipi_search")
def test_bench_tipi_code_simple(benchmark, client):
    """
    Benchmark TIPI lookup by NCM code.
    Example: 8703 (Automóveis) - High value tax lookup.
    """

    def run_lookup():
        response = client.get("/api/tipi/search?ncm=8703")
        assert response.status_code == 200

    benchmark(run_lookup)


@pytest.mark.benchmark(group="tipi_search")
def test_bench_tipi_text_search(benchmark, client):
    """
    Benchmark TIPI text search.
    Example: 'cerveja' (Common IPI query).
    """

    def run_search():
        response = client.get("/api/tipi/search?ncm=cerveja")
        assert response.status_code == 200

    benchmark(run_search)
