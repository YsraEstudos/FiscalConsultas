
import sqlite3
from pathlib import Path
import html

PROJECT_ROOT = Path(__file__).parent.parent.parent
DB_PATH = PROJECT_ROOT / "tipi.db"
OUTPUT_FILE = PROJECT_ROOT / "tipi_tree_dump.html"

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>TIPI Hierarchy Visualization</title>
    <style>
        body {{ font-family: monospace; background: #1a1a2e; color: #e2e8f0; padding: 20px; }}
        .node {{ margin-left: 20px; border-left: 1px solid #4b5563; padding: 4px; }}
        .level-0 {{ color: #f59e0b; font-weight: bold; font-size: 1.2em; margin-top: 10px; border-bottom: 1px solid #f59e0b; }}
        .level-1 {{ color: #60a5fa; font-weight: bold; }}
        .level-2 {{ color: #34d399; }}
        .level-3 {{ color: #a78bfa; }}
        .level-4 {{ color: #f472b6; }}
        .level-5 {{ color: #ef4444; font-style: italic; }} /* Exceções */
        .meta {{ color: #6b7280; font-size: 0.8em; margin-left: 10px; }}
        .sort-key {{ color: #4b5563; font-size: 0.7em; }}
    </style>
</head>
<body>
    <h1>TIPI Hierarchy Dump (Chapter 84 & 85 Samples)</h1>
    <p>Visual verification of 'ncm_sort' logic.</p>
    <div class="tree">
        {content}
    </div>
</body>
</html>
"""

def generate_visual_tree():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Buscar apenas capitulos criticos para nao gerar HTML gigante
    # Mas ordenado por ncm_sort para validar a correção
    cursor.execute("""
        SELECT ncm, descricao, nivel, ncm_sort, capitulo 
        FROM tipi_positions 
        WHERE capitulo IN ('84', '85')
        ORDER BY ncm_sort
    """)
    
    html_parts = []
    
    for row in cursor.fetchall():
        ncm = row['ncm']
        desc = html.escape(row['descricao'][:60])
        nivel = row['nivel']
        sort_key = row['ncm_sort']
        
        indent = "&nbsp;" * (nivel * 4)
        wrapper_class = f"node level-{min(nivel, 5)}"
        
        line = f'''
        <div class="{wrapper_class}">
            {indent}{ncm} <span class="meta">{desc}...</span> <span class="sort-key">[{sort_key}]</span>
        </div>
        '''
        html_parts.append(line)
        
    conn.close()
    
    full_html = HTML_TEMPLATE.format(content="\n".join(html_parts))
    
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(full_html)
        
    print(f"Generated visual report at: {OUTPUT_FILE}")

if __name__ == "__main__":
    generate_visual_tree()
