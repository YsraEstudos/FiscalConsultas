from __future__ import annotations

from dataclasses import dataclass
import threading


@dataclass(slots=True)
class PayloadCacheSnapshot:
    hits: int
    misses: int
    sets: int
    evictions: int
    served_gzip: int
    served_identity: int
    current_size: int
    max_size: int
    hit_rate: float


class PayloadCacheMetrics:
    """Thread-safe counters for payload cache observability."""

    def __init__(self, name: str):
        self.name = name
        self._hits = 0
        self._misses = 0
        self._sets = 0
        self._evictions = 0
        self._served_gzip = 0
        self._served_identity = 0
        self._lock = threading.Lock()

    def record_hit(self) -> None:
        with self._lock:
            self._hits += 1

    def record_miss(self) -> None:
        with self._lock:
            self._misses += 1

    def record_set(self) -> None:
        with self._lock:
            self._sets += 1

    def record_eviction(self, count: int = 1) -> None:
        if count <= 0:
            return
        with self._lock:
            self._evictions += count

    def record_served(self, *, gzip: bool) -> None:
        with self._lock:
            if gzip:
                self._served_gzip += 1
            else:
                self._served_identity += 1

    def snapshot(self, *, current_size: int, max_size: int) -> PayloadCacheSnapshot:
        with self._lock:
            hits = self._hits
            misses = self._misses
            sets = self._sets
            evictions = self._evictions
            served_gzip = self._served_gzip
            served_identity = self._served_identity

        total = hits + misses
        hit_rate = (hits / total) if total > 0 else 0.0
        return PayloadCacheSnapshot(
            hits=hits,
            misses=misses,
            sets=sets,
            evictions=evictions,
            served_gzip=served_gzip,
            served_identity=served_identity,
            current_size=current_size,
            max_size=max_size,
            hit_rate=round(hit_rate, 4),
        )


search_payload_cache_metrics = PayloadCacheMetrics("search_code_payload_cache")
tipi_payload_cache_metrics = PayloadCacheMetrics("tipi_code_payload_cache")
