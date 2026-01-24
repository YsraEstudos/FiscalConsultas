import sqlite3
import textwrap

def verify_integration():
    conn = sqlite3.connect('tipi.db')
    cursor = conn.cursor()

    print("=== Verification 1: Check Specific Hierarchy for 84.13 ===")
    cursor.execute("""
        SELECT ncm, descricao, nivel, aliquota 
        FROM tipi_positions 
        WHERE ncm LIKE '8413.1%' OR ncm = '84.13' 
        ORDER BY ncm
    """)
    rows = cursor.fetchall()

    found_nodes = {
        '0': False,
        '1': False, 
        '2': False,
        '3': False,
        '4': False
    }

    if not rows:
        print("FAIL: No rows found for 8413.1")
    else:
        print(f"{'NCM':<15} | {'Nivel':<5} | {'Aliquota':<8} | {'Descricao'}")
        print("-" * 60)
        for r in rows:
            print(f"{r[0]:<15} | {r[2]:<5} | {r[3]:<8} | {r[1][:40]}...")
            if r[2] in [0,1,2,3,4]: found_nodes[str(r[2])] = True

    print("\n=== Verification 2: Check for Duplicates ===")
    cursor.execute("SELECT ncm, COUNT(*) as c FROM tipi_positions GROUP BY ncm HAVING c > 1")
    dups = cursor.fetchall()
    if dups:
        print(f"FAIL: Found {len(dups)} duplicates!")
        for d in dups: print(d)
    else:
        print("PASS: No duplicates found.")

    print("\n=== Verification 3: Check Level Distribution ===")
    cursor.execute("SELECT nivel, COUNT(*) from tipi_positions GROUP BY nivel ORDER BY nivel")
    for r in cursor.fetchall():
        print(f"Level {r[0]}: {r[1]} items")
        
    conn.close()

if __name__ == "__main__":
    verify_integration()
