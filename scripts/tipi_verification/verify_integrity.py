
import sqlite3
from pathlib import Path
import sys

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.append(str(PROJECT_ROOT))

DB_PATH = PROJECT_ROOT / "tipi.db"

def check_db_integrity():
    if not DB_PATH.exists():
        print(f"ERRO: Banco de dados não encontrado em {DB_PATH}")
        return

    print(f"Verificando banco de dados: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Verificar contagem total
    cursor.execute("SELECT COUNT(*) FROM tipi_positions")
    total = cursor.fetchone()[0]
    print(f"Total de posições: {total}")

    # 2. Verificar hierarquia do Capítulo 84
    print("\n--- Analisando Capítulo 84 ---")
    cursor.execute("SELECT ncm, nivel, parent_ncm FROM tipi_positions WHERE capitulo = '84' ORDER BY ncm")
    rows = cursor.fetchall()
    
    if not rows:
        print("ERRO: Capítulo 84 vazio!")
        return

    print(f"Itens no Capítulo 84: {len(rows)}")
    
    # Amostra de itens ao redor de 84.13
    print("\nAmostra de itens (84.12 - 84.14):")
    for ncm, nivel, parent in rows:
        if ncm.startswith("84.12") or ncm.startswith("8412") or \
           ncm.startswith("84.13") or ncm.startswith("8413") or \
           ncm.startswith("84.14") or ncm.startswith("8414"):
            print(f"  [{nivel}] {ncm} (Parent: {parent})")

    conn.close()

if __name__ == "__main__":
    check_db_integrity()
