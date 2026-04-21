import pytest

from backend.utils.payload_cache_metrics import (
    PayloadCacheMetrics,
    PayloadCacheSnapshot,
    search_payload_cache_metrics,
    tipi_payload_cache_metrics,
)

pytestmark = pytest.mark.unit


def test_payload_cache_metrics_snapshot_tracks_all_counters() -> None:
    metrics = PayloadCacheMetrics("demo")

    metrics.record_hit()
    metrics.record_hit()
    metrics.record_miss()
    metrics.record_set()
    metrics.record_eviction()
    metrics.record_eviction(2)
    metrics.record_eviction(0)
    metrics.record_served(gzip=True)
    metrics.record_served(gzip=False)

    snapshot = metrics.snapshot(current_size=3, max_size=5)

    assert isinstance(snapshot, PayloadCacheSnapshot)
    assert snapshot.hits == 2
    assert snapshot.misses == 1
    assert snapshot.sets == 1
    assert snapshot.evictions == 3
    assert snapshot.served_gzip == 1
    assert snapshot.served_identity == 1
    assert snapshot.current_size == 3
    assert snapshot.max_size == 5
    assert snapshot.hit_rate == 0.6667


def test_payload_cache_metrics_snapshot_handles_empty_counters() -> None:
    metrics = PayloadCacheMetrics("empty")

    snapshot = metrics.snapshot(current_size=0, max_size=10)

    assert snapshot.hit_rate == 0.0
    assert snapshot.hits == 0
    assert snapshot.misses == 0


def test_shared_metrics_instances_keep_expected_names() -> None:
    assert search_payload_cache_metrics.name == "search_code_payload_cache"
    assert tipi_payload_cache_metrics.name == "tipi_code_payload_cache"
