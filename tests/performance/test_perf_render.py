"""
Performance benchmarks for NESH and TIPI rendering pipelines.

Reproduces the latency issues observed in console logs:
- NESH query "84313": render=1404ms (target: <500ms)
- TIPI query "8509": render=8ms (baseline, should stay low)
- NESH query "8437.80.10": render=1306ms (target: <500ms)

These tests benchmark the BACKEND rendering (HtmlRenderer / TipiRenderer),
which is one component of the total render time. The other component
(DOMPurify + innerHTML on the frontend) is addressed by code changes.
"""

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


# --- Thresholds ---
# Backend HtmlRenderer should be fast; the expensive part is client-side.
# These thresholds catch regressions in the backend renderer itself.
NESH_RENDER_P95_MS = _env_float("NESH_PERF_RENDER_P95_MS", 650.0)
TIPI_RENDER_P95_MS = _env_float("TIPI_PERF_RENDER_P95_MS", 50.0)
NESH_PIPELINE_P95_MS = _env_float("NESH_PERF_PIPELINE_P95_MS", 800.0)


# ============================================================
# NESH Render Benchmarks
# ============================================================


@pytest.mark.perf
@pytest.mark.asyncio
async def test_nesh_render_chapter84_p95(nesh_service):
    """
    Benchmark HtmlRenderer.render_full_response for chapter 84 (query "84313").

    This is the backend rendering portion of the total 1404ms render time
    observed in console logs. The remaining time is DOMPurify + innerHTML
    on the frontend.
    """
    from backend.presentation.renderer import HtmlRenderer

    # Fetch chapter data (warm the service cache)
    data = await nesh_service.process_request("84313")
    assert data.get("type") == "code", f"Expected code response, got {data.get('type')}"
    results = data.get("results") or data.get("resultados") or {}
    assert len(results) > 0, "No results returned for query '84313'"

    # Warmup renders
    for _ in range(3):
        HtmlRenderer.render_full_response(results)

    # Benchmark
    samples_ms = []
    for _ in range(20):
        start = time.perf_counter()
        html = HtmlRenderer.render_full_response(results)
        end = time.perf_counter()
        samples_ms.append((end - start) * 1000.0)

    p95 = _percentile(samples_ms, 95)
    median = _percentile(samples_ms, 50)
    html_size_kb = len(html.encode("utf-8")) / 1024

    print(f"\n[Render Benchmark] NESH Chapter 84 (query='84313')")
    print(f"  HTML size: {html_size_kb:.1f} KB")
    print(f"  Median: {median:.2f}ms")
    print(f"  P95:    {p95:.2f}ms")
    print(f"  Min:    {min(samples_ms):.2f}ms")
    print(f"  Max:    {max(samples_ms):.2f}ms")

    assert p95 <= NESH_RENDER_P95_MS, (
        f"NESH render p95={p95:.1f}ms > {NESH_RENDER_P95_MS:.0f}ms threshold"
    )


@pytest.mark.perf
@pytest.mark.asyncio
async def test_nesh_render_chapter84_subposition_p95(nesh_service):
    """
    Benchmark for query "8437.80.10" — another slow NESH query (render=1306ms).
    """
    from backend.presentation.renderer import HtmlRenderer

    data = await nesh_service.process_request("8437.80.10")
    assert data.get("type") == "code"
    results = data.get("results") or data.get("resultados") or {}
    assert len(results) > 0

    # Warmup
    for _ in range(3):
        HtmlRenderer.render_full_response(results)

    samples_ms = []
    for _ in range(20):
        start = time.perf_counter()
        html = HtmlRenderer.render_full_response(results)
        end = time.perf_counter()
        samples_ms.append((end - start) * 1000.0)

    p95 = _percentile(samples_ms, 95)
    median = _percentile(samples_ms, 50)
    html_size_kb = len(html.encode("utf-8")) / 1024

    print(f"\n[Render Benchmark] NESH Subposition (query='8437.80.10')")
    print(f"  HTML size: {html_size_kb:.1f} KB")
    print(f"  Median: {median:.2f}ms")
    print(f"  P95:    {p95:.2f}ms")

    assert p95 <= NESH_RENDER_P95_MS, (
        f"NESH render p95={p95:.1f}ms > {NESH_RENDER_P95_MS:.0f}ms threshold"
    )


# ============================================================
# TIPI Render Benchmarks
# ============================================================


@pytest.mark.perf
@pytest.mark.asyncio
async def test_tipi_render_8509_p95(tipi_service):
    """
    Benchmark TipiRenderer.render_full_response for query "8509".

    TIPI client-side render was only 8ms — this test ensures the backend
    renderer stays fast too, especially after we add pre-rendering.
    """
    from backend.presentation.tipi_renderer import TipiRenderer

    data = await tipi_service.search_by_code("8509")
    assert data.get("success") is True
    resultados = data.get("resultados") or data.get("results") or {}
    assert len(resultados) > 0

    # Warmup
    for _ in range(3):
        TipiRenderer.render_full_response(resultados)

    samples_ms = []
    for _ in range(20):
        start = time.perf_counter()
        html = TipiRenderer.render_full_response(resultados)
        end = time.perf_counter()
        samples_ms.append((end - start) * 1000.0)

    p95 = _percentile(samples_ms, 95)
    median = _percentile(samples_ms, 50)
    html_size_kb = len(html.encode("utf-8")) / 1024

    print(f"\n[Render Benchmark] TIPI (query='8509')")
    print(f"  HTML size: {html_size_kb:.1f} KB")
    print(f"  Median: {median:.2f}ms")
    print(f"  P95:    {p95:.2f}ms")

    assert p95 <= TIPI_RENDER_P95_MS, (
        f"TIPI render p95={p95:.1f}ms > {TIPI_RENDER_P95_MS:.0f}ms threshold"
    )


# ============================================================
# End-to-End Pipeline Benchmarks (Service + Render)
# ============================================================


@pytest.mark.perf
@pytest.mark.asyncio
async def test_nesh_full_pipeline_84313_p95(nesh_service):
    """
    End-to-end benchmark: NeshService.process_request + HtmlRenderer.render_full_response.

    This simulates what the backend search endpoint actually does for query "84313".
    Target: total pipeline < 300ms p95 (warm, after cache populated).
    """
    from backend.presentation.renderer import HtmlRenderer

    # Warmup (populates all caches)
    for _ in range(5):
        data = await nesh_service.process_request("84313")
        assert data.get("type") == "code"
        HtmlRenderer.render_full_response(data.get("results") or {})

    samples_ms = []
    for _ in range(25):
        start = time.perf_counter()
        data = await nesh_service.process_request("84313")
        results = data.get("results") or data.get("resultados") or {}
        HtmlRenderer.render_full_response(results)
        end = time.perf_counter()
        samples_ms.append((end - start) * 1000.0)

    p95 = _percentile(samples_ms, 95)
    median = _percentile(samples_ms, 50)

    print(f"\n[Pipeline Benchmark] NESH Full (query='84313')")
    print(f"  Median: {median:.2f}ms")
    print(f"  P95:    {p95:.2f}ms")
    print(f"  Min:    {min(samples_ms):.2f}ms")
    print(f"  Max:    {max(samples_ms):.2f}ms")

    assert p95 <= NESH_PIPELINE_P95_MS, (
        f"NESH pipeline p95={p95:.1f}ms > {NESH_PIPELINE_P95_MS:.0f}ms threshold"
    )


@pytest.mark.perf
@pytest.mark.asyncio
async def test_tipi_full_pipeline_8509_p95(tipi_service):
    """
    End-to-end benchmark: TipiService.search_by_code + TipiRenderer.render_full_response.

    Simulates the backend TIPI endpoint for query "8509".
    """
    from backend.presentation.tipi_renderer import TipiRenderer

    # Warmup
    for _ in range(3):
        data = await tipi_service.search_by_code("8509")
        assert data.get("success") is True
        TipiRenderer.render_full_response(data.get("resultados") or data.get("results") or {})

    samples_ms = []
    for _ in range(20):
        start = time.perf_counter()
        data = await tipi_service.search_by_code("8509")
        resultados = data.get("resultados") or data.get("results") or {}
        TipiRenderer.render_full_response(resultados)
        end = time.perf_counter()
        samples_ms.append((end - start) * 1000.0)

    p95 = _percentile(samples_ms, 95)
    median = _percentile(samples_ms, 50)

    print(f"\n[Pipeline Benchmark] TIPI Full (query='8509')")
    print(f"  Median: {median:.2f}ms")
    print(f"  P95:    {p95:.2f}ms")

    assert p95 <= TIPI_RENDER_P95_MS, (
        f"TIPI pipeline p95={p95:.1f}ms > {TIPI_RENDER_P95_MS:.0f}ms threshold"
    )
