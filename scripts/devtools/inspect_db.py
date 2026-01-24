import sqlite3
import os
import argparse
from pathlib import Path

def inspect_db(path):
    print(f"\n=== {path} ===")
    if not os.path.exists(path):
        print("  File does not exist!")
        return
        
    print(f"  Size: {os.path.getsize(path)} bytes")
    
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [t[0] for t in cur.fetchall()]
        print(f"  Tables: {tables}")
        
        for table in tables:
            try:
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                count = cur.fetchone()[0]
                print(f"    - {table}: {count} rows")
            except Exception as e:
                print(f"    - {table}: Error checking count ({e})")
        
        conn.close()
    except Exception as e:
        print(f"  Error: {e}")

def main():
    parser = argparse.ArgumentParser(description="Inspect SQLite DB Schema")
    parser.add_argument("paths", nargs='+', help="Paths to DB files")
    args = parser.parse_args()
    
    for path in args.paths:
        inspect_db(path)

if __name__ == "__main__":
    main()
