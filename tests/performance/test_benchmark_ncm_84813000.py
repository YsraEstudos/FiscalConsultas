import pytest

from backend.presentation.routes import search as search_route


@pytest.mark.benchmark(group="core_search_84813000")
def test_bench_ncm_84813000_first_load(benchmark, client):
    """Measure first load for NCM 8481.30.00 with payload cache cold."""

    def run_lookup():
        search_route._code_payload_cache.clear()
        response = client.get("/api/search?ncm=8481.30.00", headers={"Accept-Encoding": "identity"})
        assert response.status_code == 200
        assert response.headers.get("X-Payload-Cache") == "MISS"

    benchmark.pedantic(run_lookup, rounds=3, iterations=1)


@pytest.mark.benchmark(group="core_search_84813000")
def test_bench_ncm_84813000_warm_hit(benchmark, client):
    """Measure warm lookup for NCM 8481.30.00 when payload cache is hot."""
    search_route._code_payload_cache.clear()
    warm = client.get("/api/search?ncm=8481.30.00", headers={"Accept-Encoding": "identity"})
    assert warm.status_code == 200

    def run_lookup():
        response = client.get("/api/search?ncm=8481.30.00", headers={"Accept-Encoding": "identity"})
        assert response.status_code == 200
        assert response.headers.get("X-Payload-Cache") == "HIT"

    benchmark.pedantic(run_lookup, rounds=8, iterations=1, warmup_rounds=1)
