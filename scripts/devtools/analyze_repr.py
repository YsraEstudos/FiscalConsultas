import sqlite3

conn = sqlite3.connect('nesh.db')
cursor = conn.cursor()

print("=== Analisando estrutura do conteúdo 73.24 ===")
cursor.execute("SELECT chapter_num, content FROM chapters WHERE chapter_num = '73'")
row = cursor.fetchone()
if row:
    content = row[1]
    
    # Encontrar região específica com 73.24
    idx = content.find('73.24')
    if idx > 0:
        # Mostrar 500 caracteres ao redor
        start = max(0, idx-100)
        end = min(len(content), idx+500)
        snippet = content[start:end]
        print("=== Contexto do primeiro 73.24 ===")
        print(repr(snippet))
        print("\n" + "="*50)
        print("\n=== Texto legível ===")
        print(snippet)
        
conn.close()
