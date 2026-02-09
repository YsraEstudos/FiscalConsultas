import math
import os
import time
import pytest

def _percentile(values_ms: list[float], percentile: float) -> float:
    if not values_ms:
        raise ValueError("empty values")
    values_ms_sorted = sorted(values_ms)
    k = (len(values_ms_sorted) - 1) * (percentile / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return values_ms_sorted[int(k)]
    d0 = values_ms_sorted[f] * (c - k)
    d1 = values_ms_sorted[c] * (k - f)
    return d0 + d1


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


# Thresholds (ajustados após otimização L1+L2 cache + split query)
WARM_P95_MS_CODE = _env_float("NESH_PERF_WARM_CODE_P95_MS", 15.0)
WARM_P95_MS_FTS = _env_float("NESH_PERF_WARM_FTS_P95_MS", 30.0)
WARM_P95_MS_TIPI = _env_float("NESH_PERF_WARM_TIPI_P95_MS", 30.0)
COLD_START_P95_MS = _env_float("NESH_PERF_COLD_START_P95_MS", 6000.0)


@pytest.mark.perf
@pytest.mark.asyncio
async def test_perf_warm_pipeline_code_p95(nesh_service):
    from backend.presentation.renderer import HtmlRenderer

    # Warmup
    for _ in range(5):
        warm = await nesh_service.process_request("85")
        assert warm.get("type") == "code"
        HtmlRenderer.render_full_response(warm["results"])

    samples_ms = []
    for _ in range(30):
        start = time.perf_counter()
        data = await nesh_service.process_request("85")
        assert data.get("success") is True
        assert data.get("type") == "code"
        HtmlRenderer.render_full_response(data["results"])
        end = time.perf_counter()
        samples_ms.append((end - start) * 1000.0)

    p95 = _percentile(samples_ms, 95)
    # Using specific print to help seeing results in stdout
    print(f"\n[Manual Async Benchmark] Pipeline Code P95: {p95:.2f}ms")
    assert p95 <= WARM_P95_MS_CODE, f"p95={p95:.1f}ms > {WARM_P95_MS_CODE:.0f}ms"


@pytest.mark.perf
@pytest.mark.asyncio
async def test_perf_warm_service_fts_p95(nesh_service):
    # Warmup
    for _ in range(5):
        warm = await nesh_service.process_request("bomba submersivel")
        assert warm.get("success") is True

    samples_ms = []
    for _ in range(25):
        start = time.perf_counter()
        data = await nesh_service.process_request("bomba submersivel")
        assert data.get("success") is True
        end = time.perf_counter()
        samples_ms.append((end - start) * 1000.0)

    p95 = _percentile(samples_ms, 95)
    print(f"\n[Manual Async Benchmark] Service FTS P95: {p95:.2f}ms")
    assert p95 <= WARM_P95_MS_FTS, f"p95={p95:.1f}ms > {WARM_P95_MS_FTS:.0f}ms"


@pytest.mark.perf
@pytest.mark.asyncio
async def test_perf_warm_tipi_code_render_p95(tipi_service):
    from backend.presentation.tipi_renderer import TipiRenderer

    # Warmup
    for _ in range(3):
        warm = await tipi_service.search_by_code("8517")
        assert warm.get("success") is True
        TipiRenderer.render_full_response(warm.get("resultados") or warm.get("results") or {})

    samples_ms = []
    for _ in range(20):
        start = time.perf_counter()
        data = await tipi_service.search_by_code("8517")
        assert data.get("success") is True
        TipiRenderer.render_full_response(data.get("resultados") or data.get("results") or {})
        end = time.perf_counter()
        samples_ms.append((end - start) * 1000.0)

    p95 = _percentile(samples_ms, 95)
    print(f"\n[Manual Async Benchmark] TIPI Code Render P95: {p95:.2f}ms")
    assert p95 <= WARM_P95_MS_TIPI, f"p95={p95:.1f}ms > {WARM_P95_MS_TIPI:.0f}ms"


@pytest.mark.perf
def test_perf_cold_start_p95(benchmark, cold_start_measure):
    # This test is synchronous (subprocess), so we can keep using benchmark fixture
    def _timed_start() -> None:
        cold_start_measure(timeout_s=30.0)

    benchmark.pedantic(_timed_start, rounds=7, iterations=1, warmup_rounds=1)

    samples_ms = [v * 1000.0 for v in benchmark.stats.stats.data]
    p95 = _percentile(samples_ms, 95)
    assert p95 <= COLD_START_P95_MS, f"cold-start p95={p95:.0f}ms > {COLD_START_P95_MS:.0f}ms"
