import sqlite3

def get_tables(db):
    conn = sqlite3.connect(db)
    c = conn.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in c.fetchall()]
    print(f"\nTables in {db}: {tables}")
    for t in tables:
        if t.startswith('sqlite_'): continue
        print(f"\nSchema for {t}:")
        c.execute(f"PRAGMA table_info({t})")
        for col in c.fetchall():
            print(f"  {col[1]} ({col[2]})")
        
        print(f"\nSample data from {t}:")
        try:
            c.execute(f"SELECT * FROM {t} LIMIT 2")
            for row in c.fetchall():
                print(f"  {row}")
        except Exception as e:
            print(f"  Error: {e}")
    conn.close()

if __name__ == "__main__":
    get_tables("database/nesh.db")
