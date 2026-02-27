import hashlib
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.server.app import app

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
    "foobarxyz",
]


def main() -> None:
    out_path = Path("snapshots") / "baseline_v1.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cases: dict[str, dict[str, object]] = {}

    with TestClient(app) as client:
        for query in TEST_CASES:
            response = client.get(f"/api/search?ncm={query}")
            response.raise_for_status()
            data = response.json()

            content_str = json.dumps(data, sort_keys=True)
            digest = hashlib.sha256(content_str.encode("utf-8")).hexdigest()

            if data.get("type") == "code":
                count = int(data.get("total_capitulos") or 0)
            else:
                count = len(data.get("results", []) or [])

            cases[query] = {
                "hash": digest,
                "count": count,
                "type": data.get("type"),
            }

    payload = {
        "version": "v1",
        "generated_from": "scripts/generate_snapshot_baseline.py",
        "cases": cases,
    }

    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    print(f"snapshot written: {out_path}")


if __name__ == "__main__":
    main()
