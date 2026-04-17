import sqlite3
import os

db_path = 'database/services.db'
print(os.path.abspath(db_path))
try:
    conn = sqlite3.connect(db_path)
    print("NEBS entries:")
    for row in conn.execute("SELECT code, code_clean, parser_status FROM nebs_entries WHERE code LIKE '1.0501.11%'").fetchall():
        print(row)
except Exception as e:
    print(e)
