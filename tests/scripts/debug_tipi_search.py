"""Debug script for TIPI search issue."""
import sqlite3
from pathlib import Path

# Connect to TIPI database
db_path = Path(__file__).parent.parent / "tipi.db"
print(f"DB Path: {db_path}")
print(f"Exists: {db_path.exists()}")

conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# Test 1: Check table structure
print("\n=== Table Structure ===")
cursor.execute("PRAGMA table_info(tipi_positions)")
cols = cursor.fetchall()
for col in cols:
    print(f"  {col}")

# Test 2: Sample NCMs from chapter 85
print("\n=== Sample NCMs from Chapter 85 ===")
cursor.execute("SELECT DISTINCT ncm FROM tipi_positions WHERE capitulo = '85' ORDER BY ncm LIMIT 20")
ncms = [r[0] for r in cursor.fetchall()]
for ncm in ncms:
    print(f"  {ncm}")

# Test 3: Check what patterns would match 8517
print("\n=== Testing LIKE patterns for 8517 ===")
patterns = ['8517%', '85.17%', '85.17.%']
for p in patterns:
    cursor.execute("SELECT ncm FROM tipi_positions WHERE ncm LIKE ?", (p,))
    results = [r[0] for r in cursor.fetchall()]
    print(f"  LIKE '{p}': {len(results)} results - {results[:5]}")

# Test 4: What clean_query = 8517 would produce
print("\n=== TipiService patterns for query='8517' ===")
query_part = "8517"
clean_query = query_part.replace(".", "").replace("-", "")

# Dotted prefix logic
digits = clean_query
groups = [digits[i:i+2] for i in range(0, len(digits), 2)]
dotted_prefix = ".".join(groups)

like_pattern_1 = f"{query_part.strip()}%"  # "8517%"
like_pattern_2 = f"{clean_query}%"          # "8517%"
like_pattern_3 = f"{dotted_prefix}%"        # "85.17%"

print(f"  Pattern 1: '{like_pattern_1}'")
print(f"  Pattern 2: '{like_pattern_2}'")
print(f"  Pattern 3: '{like_pattern_3}'")

cursor.execute(
    "SELECT ncm FROM tipi_positions WHERE ncm LIKE ? OR ncm LIKE ? OR ncm LIKE ?",
    (like_pattern_1, like_pattern_2, like_pattern_3)
)
results = [r[0] for r in cursor.fetchall()]
print(f"  Combined results: {len(results)} - {results[:10]}")

# Test 5: What about patterns that would work?
print("\n=== All distinct NCM formats ===")
cursor.execute("SELECT DISTINCT substr(ncm, 1, 7) as prefix FROM tipi_positions GROUP BY prefix ORDER BY prefix LIMIT 30")
prefixes = [r[0] for r in cursor.fetchall()]
for prefix in prefixes:
    print(f"  {prefix}")

conn.close()
print("\n=== DONE ===")
