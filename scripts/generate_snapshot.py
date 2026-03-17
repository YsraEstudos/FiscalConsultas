import hashlib
import json
from datetime import datetime

import requests

BASE_URL = "http://localhost:8000"  # NOSONAR - local test endpoint
SNAPSHOT_FILE = "snapshots/baseline_v1.json"

TEST_CASES = [
    "85",
    "73",
    "01",
    "73.18",
    "8471.30",
    "8708",
    "parafusos",
    "motor eletrico",
    "maquina de lavar",
    "85,73",
    "9999",
    "foobarxyz",
]


def run_snapshot() -> None:
    print(f"Running snapshot generation against {BASE_URL}...")
    results = {}

    for query in TEST_CASES:
        try:
            url = f"{BASE_URL}/api/search?ncm={query}"
            print(f"Fetching: {query.ljust(20)}", end="")

            resp = requests.get(url, timeout=10)
            data = resp.json()
            content_str = json.dumps(data, sort_keys=True)
            content_hash = hashlib.sha256(content_str.encode("utf-8")).hexdigest()

            results[query] = {
                "status": resp.status_code,
                "hash": content_hash,
                "type": data.get("type"),
                "count": (
                    len(data.get("results", []))
                    if data.get("type") == "text"
                    else data.get("total_capitulos")
                ),
                "data_preview": str(data)[:100],
            }
            print(f" OK (Type: {data.get('type')})")

        except Exception as exc:  # noqa: BLE001
            print(f" ERROR: {exc}")
            results[query] = {"error": str(exc)}

    with open(SNAPSHOT_FILE, "w", encoding="utf-8") as snapshot_file:
        json.dump(
            {"timestamp": datetime.now().isoformat(), "cases": results},
            snapshot_file,
            indent=2,
        )

    print(f"\nSnapshot saved to {SNAPSHOT_FILE}")


if __name__ == "__main__":
    run_snapshot()
