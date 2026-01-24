"""Diagnóstico rápido do estado do FTS no nesh.db."""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "nesh.db")

def main():
    if not os.path.exists(DB_PATH):
        print(f"❌ nesh.db não encontrado em: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 1. Listar tabelas
    c.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in c.fetchall()]
    print(f"Tabelas: {tables}")

    # 2. Verifica search_index
    if "search_index" not in tables:
        print("❌ Tabela 'search_index' NÃO existe. Rode: python scripts/rebuild_index.py")
        return

    # 3. Conta entradas
    c.execute("SELECT count(*) FROM search_index")
    count = c.fetchone()[0]
    print(f"Entradas FTS: {count}")

    # 4. Colunas
    c.execute("PRAGMA table_info(search_index)")
    cols = [r[1] for r in c.fetchall()]
    print(f"Colunas FTS: {cols}")

    # 5. Teste busca "parafuso"
    content_col = "indexed_content" if "indexed_content" in cols else "description"
    try:
        c.execute(f"SELECT ncm, display_text FROM search_index WHERE {content_col} MATCH 'parafus*' LIMIT 5")
        results = c.fetchall()
        print(f"Busca 'parafus*' ({content_col}): {len(results)} resultados")
        for r in results:
            print(f"  {r[0]}: {r[1][:60]}")
    except Exception as e:
        print(f"❌ Erro na busca: {e}")

    conn.close()

if __name__ == "__main__":
    main()
