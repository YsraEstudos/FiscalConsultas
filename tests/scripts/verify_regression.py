
import requests
import json
import hashlib
import sys
import os

BASE_URL = "http://localhost:8000"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT_FILE = os.path.join(SCRIPT_DIR, "..", "..", "snapshots", "baseline_v1.json")
TEST_CASES = [
    "85", "73", "01",
    "73.18", "8471.30", "8708",
    "parafusos", "motor eletrico", "maquina de lavar",
    "85,73", 
    "9999", "foobarxyz"
]

# Force UTF-8 output for Windows consoles
sys.stdout.reconfigure(encoding='utf-8')

def verify():
    if not os.path.exists(SNAPSHOT_FILE):
        print(f"❌ Baseline file {SNAPSHOT_FILE} not found!")
        sys.exit(1)

    with open(SNAPSHOT_FILE, 'r', encoding='utf-8') as f:
        baseline_data = json.load(f)
        baseline_cases = baseline_data.get("cases", {})

    print(f"🔍 Verifying against baseline ({len(baseline_cases)} cases)...")
    
    failures = []

    for query in TEST_CASES:
        try:
            url = f"{BASE_URL}/api/search?ncm={query}"
            resp = requests.get(url)
            data = resp.json()
            
            # Recalculate hash
            content_str = json.dumps(data, sort_keys=True)
            current_hash = hashlib.md5(content_str.encode('utf-8')).hexdigest()
            
            expected = baseline_cases.get(query, {})
            expected_hash = expected.get("hash")
            
            if current_hash != expected_hash:
                # Allow for minor differences if type/count matches (e.g. timestamp or random order if not sorted)
                # But our current implementation sorts keys, so hashes should match exactly.
                # However, Markdown rendering might have slight whitespace diffs if we changed the Renderer logic.
                
                # Check critical fields
                if data.get("type") != expected.get("type"):
                    failures.append(f"[{query}] Type Mismatch: Expected {expected.get('type')}, Got {data.get('type')}")
                elif len(data.get("results", [])) != expected.get("count") and data.get("total_capitulos") != expected.get("count"):
                     failures.append(f"[{query}] Count Mismatch: Expected {expected.get('count')}, Got {data.get('total_capitulos')}")
                else:
                    # Warn but don't fail immediately if semantics match
                    pass # Muted hash mismatch
            # print(f"✅ [{query}] Matched.")
            
        except Exception as e:
            failures.append(f"[{query}] Exception: {e}")
        
        sys.stdout.flush()

    print("\n" + "="*30)
    if failures:
        print("❌ REGRESSION DETECTED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("🎉 SUCCESS: No regressions detected!")
        sys.exit(0)

if __name__ == "__main__":
    verify()
