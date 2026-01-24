import sqlite3
import re

conn = sqlite3.connect('nesh.db')
cursor = conn.cursor()

# Verificar tabela positions
print("=== Posições com 73.24 ===")
cursor.execute("SELECT codigo, descricao FROM positions WHERE codigo LIKE '73.24%'")
for row in cursor.fetchall():
    print(f"Codigo: {row[0]}")
    desc = row[1] if row[1] else "N/A"
    print(f"Descricao: {desc[:80]}...")
    print()

# Contar ocorrencias no conteudo
cursor.execute("SELECT content FROM chapters WHERE chapter_num = '73'")
result = cursor.fetchone()
if result:
    content = result[0]
    # Contar linhas que começam com 73.24
    matches = re.findall(r'^.*73\.24.*$', content, re.MULTILINE)
    print(f"\n=== {len(matches)} linhas contendo 73.24 ===")
    for i, m in enumerate(matches[:10]):
        clean = m[:100].strip()
        print(f"{i+1}. [{clean}]")

conn.close()
