"""Debug script for TIPI 8517.13 search issue."""
import sqlite3
from pathlib import Path

db_path = Path(__file__).parent.parent / "tipi.db"
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# Test: What NCMs exist for chapter 85 that start with 85.17?
print("=== NCMs starting with 85.17 ===")
cursor.execute("SELECT ncm, descricao, aliquota FROM tipi_positions WHERE ncm LIKE '85.17%' ORDER BY ncm")
for row in cursor.fetchall():
    print(f"  {row[0]} | {row[1][:50]}... | {row[2]}")

print("\n=== Testing different patterns for 8517.13 ===")
patterns = [
    '8517.13%',      # query as-is
    '851713%',       # clean (no dots)
    '85.17.13%',     # _to_dotted_prefix
    '85.17.1%',      # shorter dotted
]
for p in patterns:
    cursor.execute("SELECT COUNT(*) FROM tipi_positions WHERE ncm LIKE ?", (p,))
    count = cursor.fetchone()[0]
    print(f"  LIKE '{p}': {count} results")

# Check: How is _to_dotted_prefix working?
print("\n=== Testing _to_dotted_prefix logic ===")
query_part = "8517.13"
clean_query = query_part.replace(".", "").replace("-", "")
print(f"  query_part: {query_part}")
print(f"  clean_query: {clean_query}")

digits = clean_query
groups = [digits[i:i+2] for i in range(0, len(digits), 2)]
dotted_prefix = ".".join(groups)
print(f"  dotted_prefix: {dotted_prefix}")

# What the service actually searches
like_pattern_1 = f"{query_part.strip()}%"
like_pattern_2 = f"{clean_query}%"
like_pattern_3 = f"{dotted_prefix}%"
print(f"  Pattern 1: '{like_pattern_1}'")
print(f"  Pattern 2: '{like_pattern_2}'")
print(f"  Pattern 3: '{like_pattern_3}'")

cursor.execute(
    "SELECT ncm FROM tipi_positions WHERE ncm LIKE ? OR ncm LIKE ? OR ncm LIKE ?",
    (like_pattern_1, like_pattern_2, like_pattern_3)
)
results = [r[0] for r in cursor.fetchall()]
print(f"  Combined results: {len(results)} - {results[:10]}")

conn.close()
