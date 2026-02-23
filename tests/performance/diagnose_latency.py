"""
Diagnostic script: profile each layer of the NCM lookup pipeline.
Identifies where the ~114ms are spent (DB? cache? serialization? GZip? TestClient?).
"""

import gzip
import json
import os
import sys
import time

# Force test mode before any backend imports
os.environ.setdefault("NESH_ENV", "test")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.config.settings import settings

settings.database.engine = "sqlite"
settings.database.postgres_url = None
settings.cache.enable_redis = False

import orjson  # noqa: E402
from backend.config import CONFIG  # noqa: E402
from backend.server.app import app  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402


def measure(label, fn, rounds=50):
    """Run fn() N times, return (avg_ms, min_ms, max_ms)."""
    times = []
    for _ in range(rounds):
        t0 = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t0) * 1000)
    avg = sum(times) / len(times)
    return avg, min(times), max(times)


def measure_async(label, coro_fn, loop, rounds=50):
    """Run async fn() N times via loop."""
    times = []
    for _ in range(rounds):
        t0 = time.perf_counter()
        loop.run_until_complete(coro_fn())
        times.append((time.perf_counter() - t0) * 1000)
    avg = sum(times) / len(times)
    return avg, min(times), max(times)


def main():
    print("=" * 70)
    print("NCM Lookup Latency Diagnostic")
    print("=" * 70)

    # 1) Raw SQLite
    import sqlite3

    conn = sqlite3.connect(CONFIG.db_path)

    def raw_sql():
        c = conn.cursor()
        c.execute("SELECT content FROM chapters WHERE chapter_num = '85'")
        c.fetchone()

    avg, mn, mx = measure("Raw SQLite", raw_sql, rounds=200)
    print(
        f"\n1. Raw SQLite query:       avg={avg:.3f}ms  min={mn:.3f}ms  max={mx:.3f}ms"
    )
    conn.close()

    # 2) Full HTTP via TestClient (what benchmarks measure)
    with TestClient(app) as client:
        # Warm L1 cache
        client.get("/api/search?ncm=8517")

        # 2a) Full HTTP lookup (warm L1)
        avg, mn, mx = measure(
            "HTTP lookup", lambda: client.get("/api/search?ncm=8517"), rounds=30
        )
        print(
            f"2. Full HTTP (warm L1):    avg={avg:.3f}ms  min={mn:.3f}ms  max={mx:.3f}ms"
        )

        # 2b) Measure response size
        resp = client.get("/api/search?ncm=8517")
        body_raw = resp.content
        body_json = (
            json.loads(body_raw)
            if resp.headers.get("content-type", "").startswith("application/json")
            else None
        )
        print(f"\n   Response body bytes: {len(body_raw):,}")
        print(f"   Content-Encoding: {resp.headers.get('content-encoding', 'none')}")

        if body_json:
            # Measure serialization costs
            uncompressed_orjson = orjson.dumps(body_json)
            uncompressed_stdlib = json.dumps(body_json).encode()
            compressed = gzip.compress(uncompressed_orjson, compresslevel=6)

            print(f"   Uncompressed (orjson):  {len(uncompressed_orjson):,} bytes")
            print(f"   Uncompressed (stdlib):  {len(uncompressed_stdlib):,} bytes")
            print(f"   Gzip level-6:           {len(compressed):,} bytes")

            # Does 'resultados' exist?
            if "resultados" in body_json:
                without_dup = {k: v for k, v in body_json.items() if k != "resultados"}
                smaller = orjson.dumps(without_dup)
                print(
                    f"   Without 'resultados':   {len(smaller):,} bytes ({len(uncompressed_orjson) - len(smaller):,} bytes saved)"
                )

            # Time orjson vs stdlib
            avg_orj, _, _ = measure(
                "orjson.dumps", lambda: orjson.dumps(body_json), rounds=100
            )
            avg_std, _, _ = measure(
                "json.dumps", lambda: json.dumps(body_json).encode(), rounds=100
            )
            avg_gz, _, _ = measure(
                "gzip(orjson)",
                lambda: gzip.compress(orjson.dumps(body_json), compresslevel=6),
                rounds=50,
            )

            print(f"\n   orjson serialization:   {avg_orj:.3f}ms")
            print(f"   stdlib serialization:   {avg_std:.3f}ms")
            print(f"   gzip compression:       {avg_gz:.3f}ms")

        # 3) Complex lookup
        client.get("/api/search?ncm=8471.30")
        avg, mn, mx = measure(
            "Complex HTTP", lambda: client.get("/api/search?ncm=8471.30"), rounds=20
        )
        print(
            f"\n3. Complex HTTP (warm):    avg={avg:.3f}ms  min={mn:.3f}ms  max={mx:.3f}ms"
        )

        # 3b) Compare with Accept-Encoding: identity (no gzip)
        avg_nogz, mn_nogz, mx_nogz = measure(
            "No-GZip HTTP",
            lambda: client.get(
                "/api/search?ncm=8517", headers={"Accept-Encoding": "identity"}
            ),
            rounds=30,
        )
        print(
            f"\n4. HTTP no-gzip (warm):    avg={avg_nogz:.3f}ms  min={mn_nogz:.3f}ms  max={mx_nogz:.3f}ms"
        )
        print(f"   GZip overhead:          ~{avg - avg_nogz:.1f}ms per request")

        # 5) Measure just TestClient overhead with a minimal endpoint
        print("\n5. Summary:")
        print(f"   Raw SQL:                {measure('', raw_sql, rounds=200)[0]:.3f}ms")
        print(f"   TestClient+ovrhead:     ~{avg - 0.5:.1f}ms  (full HTTP - raw SQL)")


if __name__ == "__main__":
    main()
