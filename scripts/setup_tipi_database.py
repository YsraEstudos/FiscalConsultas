"""
Setup TIPI Database.
Processa o arquivo data/tipi.xlsx e cria o banco de dados SQLite tipi.db.

A TIPI (Tabela de Incidência do IPI) contém NCMs com alíquotas de IPI.
Estrutura do Excel (4 colunas):
    NCM | EX | Descrição | Alíquota (%)
"""

import sqlite3
import re
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("ERRO: openpyxl não instalado. Execute: pip install openpyxl")
    exit(1)

# Configuração de paths
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
TIPI_FILE = DATA_DIR / "tipi.xlsx"
DB_FILE = SCRIPT_DIR.parent / "database" / "tipi.db"

# Linha onde começam os dados (após cabeçalho)
HEADER_ROW = 8


def create_database():
    """Cria estrutura do banco de dados TIPI."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Limpar tabelas existentes (mais seguro que deletar arquivo)
    cursor.execute("DROP TABLE IF EXISTS tipi_positions")
    cursor.execute("DROP TABLE IF EXISTS tipi_chapters")
    cursor.execute("DROP TABLE IF EXISTS tipi_fts")
    
    # Tabela de capítulos
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tipi_chapters (
            codigo TEXT PRIMARY KEY,
            titulo TEXT,
            secao TEXT,
            notas TEXT
        )
    ''')
    
    # Tabela de posições/NCMs
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tipi_positions (
            ncm TEXT PRIMARY KEY,
            capitulo TEXT,
            descricao TEXT,
            aliquota TEXT,
            nivel INTEGER,
            parent_ncm TEXT,
            ncm_sort TEXT,
            FOREIGN KEY (capitulo) REFERENCES tipi_chapters(codigo)
        )
    ''')
    
    # Índice FTS para busca full-text
    cursor.execute('DROP TABLE IF EXISTS tipi_fts')
    cursor.execute('''
        CREATE VIRTUAL TABLE tipi_fts USING fts5(
            ncm,
            capitulo,
            descricao,
            aliquota
        )
    ''')
    
    conn.commit()
    return conn


def _calculate_level(ncm_clean: str, has_ex: bool = False) -> int:
    """
    Calcula o nível hierárquico baseado na estrutura do NCM limpo (apenas dígitos).
    
    Tabela de Níveis:
    - 2 dígitos (Capítulo) -> Nível 0 (Ex: 84)
    - 4 dígitos (Posição) -> Nível 1 (Ex: 8413)
    - 5 dígitos (Subposição 1) -> Nível 2 (Ex: 84131)
    - 6 dígitos (Subposição 2) -> Nível 3 (Ex: 841311)
    - 7-8 dígitos (Item) -> Nível 4 (Ex: 84131100)
    - Exceção (Ex) -> Nível 5 (sempre um nível abaixo do NCM principal)
    """
    if has_ex:
        return 5  # Exceções são sempre o nível mais baixo
    
    length = len(ncm_clean)
    if length == 2: return 0
    if length == 4: return 1
    if length == 5: return 2
    if length == 6: return 3
    if length >= 7: return 4
    return 1  # Fallback seguro


def _clean_ncm(ncm: str) -> str:
    """Remove pontos e espaços do NCM, deixando apenas dígitos."""
    return re.sub(r'[^0-9]', '', str(ncm or ''))


def parse_tipi_xlsx(filepath: Path):
    """
    Processa o arquivo TIPI (Excel) e extrai capítulos, posições e alíquotas.
    
    Returns:
        dict: {
            'chapters': [...],
            'positions': [...]
        }
    """
    print(f"Abrindo {filepath}...")
    wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    ws = wb.active
    
    chapters = {}
    positions = []
    last_ncm = None  # Para vincular exceções ao NCM principal
    
    rows_processed = 0
    rows_skipped = 0
    
    for row_num, row in enumerate(ws.iter_rows(min_row=HEADER_ROW + 1, values_only=True), start=HEADER_ROW + 1):
        if len(row) < 4:
            rows_skipped += 1
            continue
        
        ncm_raw = row[0]
        ex_raw = row[1]
        descricao = row[2]
        aliquota = row[3]
        
        # Ignorar linhas vazias
        if not ncm_raw or not str(ncm_raw).strip():
            rows_skipped += 1
            continue
        
        ncm_formatted = str(ncm_raw).strip()
        ncm_clean = _clean_ncm(ncm_formatted)
        
        # Ignorar linhas que não começam com dígitos (cabeçalhos, notas, etc)
        if not ncm_clean or len(ncm_clean) < 2:
            rows_skipped += 1
            continue
        
        # Processar descrição
        desc_str = str(descricao or '').strip()
        
        # Processar alíquota
        aliq_str = ''
        if aliquota is not None:
            aliq_str = str(aliquota).strip()
            # Normalizar NT (Não Tributável)
            if aliq_str.upper() == 'NT':
                aliq_str = 'NT'
            # Tentar extrair número
            elif aliq_str:
                try:
                    num = float(aliq_str.replace(',', '.').replace('%', ''))
                    aliq_str = str(num)
                except ValueError:
                    pass
        
        # Verificar se é exceção (Ex 1, Ex 2, etc)
        has_ex = ex_raw is not None and str(ex_raw).strip() != ''
        parent_ncm = None
        
        if has_ex:
            ex_num = str(ex_raw).strip()
            # Criar NCM único para a exceção
            ncm_key = f"{ncm_formatted} Ex {ex_num}"
            parent_ncm = last_ncm  # Vincula à posição anterior
            # Para ordenar exceções depois do pai, adicionamos sufixo
            # Pai: 84131100 -> Sort: 84131100
            # Ex: 84131100 Ex 1 -> Sort: 84131100.9999 (cheat) ou apenas append
            # Melhor: sort key + flag de exceção
            sort_key = _clean_ncm(last_ncm).ljust(12, '0') + '9' # Exceções no final
        else:
            ncm_key = ncm_formatted
            last_ncm = ncm_formatted
            sort_key = ncm_clean.ljust(12, '0')
        
        # Determinar capítulo (primeiros 2 dígitos)
        cap_codigo = ncm_clean[:2].zfill(2)
        
        # Determinar nível hierárquico
        nivel = _calculate_level(ncm_clean, has_ex)
        
        # Adicionar capítulo se não existir
        if cap_codigo not in chapters:
            chapters[cap_codigo] = {
                'codigo': cap_codigo,
                'titulo': f'Capítulo {cap_codigo}',
                'secao': '',
                'notas': ''
            }
        
        positions.append({
            'ncm': ncm_key,
            'capitulo': cap_codigo,
            'descricao': desc_str,
            'aliquota': aliq_str,
            'nivel': nivel,
            'parent_ncm': parent_ncm,
            'ncm_sort': sort_key
        })
        
        rows_processed += 1
        
        # Log de progresso a cada 1000 linhas
        if rows_processed % 1000 == 0:
            print(f"  Processadas {rows_processed} posições...")
    
    wb.close()
    
    print(f"Processamento concluído:")
    print(f"  - Linhas processadas: {rows_processed}")
    print(f"  - Linhas ignoradas: {rows_skipped}")
    print(f"  - Capítulos: {len(chapters)}")
    
    return {'chapters': list(chapters.values()), 'positions': positions}


def populate_database(conn, data):
    """Popula o banco de dados com os dados extraídos."""
    cursor = conn.cursor()
    
    # Inserir capítulos
    for ch in data['chapters']:
        cursor.execute('''
            INSERT OR REPLACE INTO tipi_chapters (codigo, titulo, secao, notas)
            VALUES (?, ?, ?, ?)
        ''', (ch['codigo'], ch['titulo'], ch['secao'], ch['notas']))
    
    # Inserir posições
    for pos in data['positions']:
        cursor.execute('''
            INSERT OR REPLACE INTO tipi_positions (ncm, capitulo, descricao, aliquota, nivel, parent_ncm, ncm_sort)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (pos['ncm'], pos['capitulo'], pos['descricao'], pos['aliquota'], pos['nivel'], pos['parent_ncm'], pos['ncm_sort']))
        
        # Inserir no índice FTS (sem exceções para manter busca limpa)
        cursor.execute('''
            INSERT INTO tipi_fts (ncm, capitulo, descricao, aliquota)
            VALUES (?, ?, ?, ?)
        ''', (pos['ncm'], pos['capitulo'], pos['descricao'], pos['aliquota']))
    
    conn.commit()
    print(f"Inseridos {len(data['chapters'])} capítulos e {len(data['positions'])} posições")


def verify_results(conn):
    """Verifica integridade dos dados inseridos."""
    cursor = conn.cursor()
    
    print("\n" + "=" * 50)
    print("VERIFICAÇÃO DE RESULTADOS")
    print("=" * 50)
    
    # Contagem total
    cursor.execute("SELECT COUNT(*) FROM tipi_positions")
    total = cursor.fetchone()[0]
    print(f"\nOK Total de posições: {total}")
    
    # Distribuição por nível
    print("\nOK Distribuição por nível:")
    cursor.execute("SELECT nivel, COUNT(*) FROM tipi_positions GROUP BY nivel ORDER BY nivel")
    for nivel, count in cursor.fetchall():
        print(f"    Nível {nivel}: {count} itens")
    
    # Verificar capítulo 84.13
    print("\nOK Amostra do capítulo 84.13:")
    cursor.execute("""
        SELECT ncm, descricao, aliquota, nivel 
        FROM tipi_positions 
        WHERE ncm LIKE '8413%' OR ncm LIKE '84.13%'
        ORDER BY ncm 
        LIMIT 15
    """)
    for ncm, desc, aliq, nivel in cursor.fetchall():
        indent = "  " * nivel
        desc_short = (desc[:40] + '...') if len(desc) > 40 else desc
        print(f"    {ncm:18} | nv{nivel} | {indent}{desc_short} | {aliq}")
    
    # Verificar exceções
    cursor.execute("SELECT COUNT(*) FROM tipi_positions WHERE ncm LIKE '% Ex %'")
    ex_count = cursor.fetchone()[0]
    print(f"\nOK Total de exceções (Ex): {ex_count}")


def main():
    print("=" * 50)
    print("Setup TIPI Database (Excel Parser)")
    print("=" * 50)
    
    if not TIPI_FILE.exists():
        print(f"ERRO: Arquivo não encontrado: {TIPI_FILE}")
        return
    
    print(f"Lendo arquivo: {TIPI_FILE}")
    print(f"Tamanho: {TIPI_FILE.stat().st_size / 1024:.1f} KB")
    
    # Criar banco de dados
    conn = create_database()
    print(f"Banco de dados criado: {DB_FILE}")
    
    # Processar arquivo Excel
    data = parse_tipi_xlsx(TIPI_FILE)
    
    # Populated DB
    populate_database(conn, data)
    
    # Verificar
    verify_results(conn)
    
    conn.close()
    print("\nOK Setup TIPI concluído!")


if __name__ == "__main__":
    main()
