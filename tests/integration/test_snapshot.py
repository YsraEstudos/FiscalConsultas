import hashlib
import json
from datetime import datetime

import requests

BASE_URL = "http://localhost:8000"  # NOSONAR - local test endpoint
SNAPSHOT_FILE = "snapshots/baseline_v1.json"

TEST_CASES = [
    # 1. Simple Chapters
    "85",
    "73",
    "01",
    # 2. Specific Positions
    "73.18",
    "8471.30",
    "8708",
    # 3. Text Searches (Fuzzy)
    "parafusos",
    "motor eletrico",
    "maquina de lavar",
    # 4. Multi-Search
    "85,73",
    # 5. Non-existent
    "9999",
    "foobarxyz",
]


def run_snapshot():
    print(f"📸 Running Snapshot Test against {BASE_URL}...")
    results = {}

    for query in TEST_CASES:
        try:
            url = f"{BASE_URL}/api/search?ncm={query}"
            print(f"Fetching: {query.ljust(20)}", end="")

            resp = requests.get(url, timeout=10)
            data = resp.json()

            # Remove timestamp/dynamic fields if any (currently none, but good practice)
            # We want deterministic output

            # Store hash + brief summary for size
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
                # Store full data for deep comparison if needed (hash usually covers regressions)
                "data_preview": str(data)[:100],
            }
            print(f"✅ (Type: {data.get('type')})")

        except Exception as e:
            print(f"❌ Error: {e}")
            results[query] = {"error": str(e)}

    # Save Snapshot
    with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {"timestamp": datetime.now().isoformat(), "cases": results}, f, indent=2
        )

    print(f"\n💾 Snapshot saved to {SNAPSHOT_FILE}")


if __name__ == "__main__":
    run_snapshot()
