"""Check both nesh.db files."""
import sqlite3
import os

paths = [
    r"c:\Users\israe\Downloads\faz tudo\Fiscal\nesh.db",
    r"c:\Users\israe\Downloads\faz tudo\Fiscal\data\nesh.db"
]

for path in paths:
    print(f"\n=== {path} ===")
    if not os.path.exists(path):
        print("  File does not exist!")
        continue
        
    print(f"  Size: {os.path.getsize(path)} bytes")
    
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [t[0] for t in cur.fetchall()]
        print(f"  Tables: {tables}")
        
        if 'chapters' in tables:
            cur.execute("SELECT COUNT(*) FROM chapters")
            print(f"  Chapters count: {cur.fetchone()[0]}")
            
            # Sample content
            cur.execute("SELECT chapter_num, substr(content, 1, 200) FROM chapters WHERE chapter_num='85'")
            row = cur.fetchone()
            if row:
                print(f"  Chapter 85 content preview:")
                print(f"    {repr(row[1][:200])}")
        
        conn.close()
    except Exception as e:
        print(f"  Error: {e}")
