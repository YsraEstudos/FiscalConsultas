import sqlite3
import os

def inspect_db(db_path):
    print(f"\nInspecting {db_path}...")
    if not os.path.exists(db_path):
        print("File not found.")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    
    for table in tables:
        table_name = table[0]
        if table_name.startswith('sqlite_'): continue
        print(f"\nTable: {table_name}")
        cursor.execute(f"PRAGMA table_info({table_name});")
        columns = cursor.fetchall()
        for col in columns:
            print(f"  Column: {col[1]} ({col[2]})")
            
        try:
            cursor.execute(f"SELECT * FROM {table_name} LIMIT 1;")
            row = cursor.fetchone()
            if row:
                # Clean up row for display (truncate long strings, handle bytes)
                clean_row = []
                for val in row:
                    if isinstance(val, bytes):
                        clean_row.append(f"<BYTES {len(val)}>")
                    elif isinstance(val, str) and len(val) > 100:
                        clean_row.append(val[:100] + "...")
                    else:
                        clean_row.append(val)
                print(f"  Sample row: {tuple(clean_row)}")
        except Exception as e:
            print(f"  Error reading sample row: {e}")
        
    conn.close()

if __name__ == "__main__":
    # inspect_db("database/tipi.db")
    inspect_db("database/nesh.db")
