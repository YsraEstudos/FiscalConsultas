
"""
Script de reconstrução do índice com Stemming (Fase 5).
Recria o banco de dados incluindo a tabela FTS5 com textos processados.
"""

import sqlite3
import re
import os
import time
import json
import unicodedata
import sys

# Adiciona diretório pai ao path para importar utils
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.utils.text_processor import NeshTextProcessor

# Configuração
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
NESH_FILE = os.path.join(SCRIPT_DIR, "..", "data", "Nesh.txt")
DB_FILE = os.path.join(SCRIPT_DIR, "..", "database", "nesh.db")
CONFIG_FILE = os.path.join(SCRIPT_DIR, "..", "config", "settings.json")

# Carrega Stopwords
try:
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = json.load(f)
        stopwords = config.get("search", {}).get("stopwords", [])
except:
    stopwords = []

processor = NeshTextProcessor(stopwords)

def extract_positions_from_chapter(chapter_content: str) -> list:
    position_pattern = r'^(\d{2}\.\d{2})\s*-'
    positions = []
    
    for line in chapter_content.split('\n'):
        match = re.match(position_pattern, line.strip())
        if match:
            pos = match.group(1)
            desc_match = re.match(r'^\d{2}\.\d{2}\s*-\s*(.+)', line.strip())
            desc = desc_match.group(1)[:200] if desc_match else ''
            positions.append({'codigo': pos, 'descricao': desc})
    
    return positions

def extract_chapter_notes(chapter_content: str) -> str:
    lines = chapter_content.split('\n')
    notes_lines = []
    notes_started = False
    
    for line in lines:
        stripped = line.strip()
        
        # Pula linhas iniciais
        if stripped.startswith('Capítulo ') or not stripped:
            if not notes_started: continue
        
        # Início/Fim
        if re.match(r'^Notas?\.?$', stripped, re.IGNORECASE):
            notes_started = True
            notes_lines.append(stripped)
            continue
        
        if not notes_started and stripped and not re.match(r'^\d{2}\.\d{2}\s*-', stripped):
             notes_started = True
             notes_lines.append(stripped)
             continue

        if re.match(r'^\d{2}\.\d{2}\s*-', stripped):
            break
        
        if notes_started:
            notes_lines.append(stripped)
    
    return '\n'.join(notes_lines).strip()

def parse_nesh_file():
    print(f"📖 Lendo {NESH_FILE}...")
    with open(NESH_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
    
    chapter_pattern = r'\nCapítulo\s+(\d+)\r?\n'
    matches = list(re.finditer(chapter_pattern, content))
    chapters = {}
    
    for i, match in enumerate(matches):
        chapter_num = match.group(1).zfill(2)
        start_pos = match.start()
        end_pos = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        chapters[chapter_num] = content[start_pos:end_pos].strip()
        
    return chapters

def create_database(chapters: dict):
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)
        print(f"🗑️  Banco anterior removido")
    
    print(f"🔨 Reconstruindo {DB_FILE} com FTS Stemmed...")
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # 1. Tabelas Estruturais
    cursor.execute('''
        CREATE TABLE chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_num TEXT UNIQUE NOT NULL,
            content TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_num TEXT NOT NULL,
            codigo TEXT NOT NULL,
            descricao TEXT,
            FOREIGN KEY (chapter_num) REFERENCES chapters(chapter_num)
        )
    ''')
    cursor.execute('''
        CREATE TABLE chapter_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_num TEXT UNIQUE NOT NULL,
            notes_content TEXT,
            FOREIGN KEY (chapter_num) REFERENCES chapters(chapter_num)
        )
    ''')
    
    # 2. Tabela FTS (Busca Textual)
    # ncm: identificador principal (capítulo ou posição)
    # display_text: texto original para exibição (título/descrição)
    # type: 'chapter' ou 'position'
    # description: para busca
    # search_index: coluna mágica onde inserimos o texto processado (stemmed)
    cursor.execute('''
        CREATE VIRTUAL TABLE search_index USING fts5(
            ncm, 
            display_text, 
            type, 
            description,
            indexed_content
        )
    ''')
    
    # Índices Relacionais
    cursor.execute('CREATE INDEX idx_chapter_num ON chapters(chapter_num)')
    cursor.execute('CREATE INDEX idx_position_code ON positions(codigo)')

    count_ch = 0
    count_pos = 0
    
    for chapter_num, content in sorted(chapters.items()):
        # Insere Capítulo Relacional
        cursor.execute('INSERT INTO chapters (chapter_num, content) VALUES (?, ?)', (chapter_num, content))
        count_ch += 1
        
        # Insere Notas
        notes = extract_chapter_notes(content)
        if notes:
            cursor.execute('INSERT INTO chapter_notes (chapter_num, notes_content) VALUES (?, ?)', (chapter_num, notes))
        
        # --- FTS para o Capítulo ---
        # Indexamos o conteúdo inteiro do capítulo? Ou só notas e título?
        # Para busca melhor, vamos indexar o capítulo inteiro, processado.
        
        # Limpa o conteúdo para não poluir o índice com formatação
        clean_content = re.sub(r'Página \d+\r?\n', '', content)
        processed_content = processor.process(clean_content)
        
        cursor.execute('''
            INSERT INTO search_index (ncm, display_text, type, description, indexed_content) 
            VALUES (?, ?, ?, ?, ?)
        ''', (
            chapter_num, 
            f"Capítulo {chapter_num}", 
            "chapter", 
            content[:200], # Descrição curta sem stem
            processed_content # TEXTO BUSCÁVEL STEMMED
        ))

        # --- Posições ---
        vals_pos = extract_positions_from_chapter(content)
        for pos in vals_pos:
            cursor.execute('INSERT INTO positions (chapter_num, codigo, descricao) VALUES (?, ?, ?)',
                         (chapter_num, pos['codigo'], pos['descricao']))
            
            # FTS para Posição
            processed_desc = processor.process(pos['descricao'])
            cursor.execute('''
                INSERT INTO search_index (ncm, display_text, type, description, indexed_content) 
                VALUES (?, ?, ?, ?, ?)
            ''', (
                pos['codigo'], 
                f"{pos['codigo']} - {pos['descricao']}", 
                "position", 
                pos['descricao'], 
                processed_desc
            ))
            count_pos += 1
            
    conn.commit()
    
    # Verify FTS
    cursor.execute("SELECT count(*) FROM search_index")
    fts_count = cursor.fetchone()[0]
    
    conn.close()
    print(f"✅ Banco recriado com sucesso!")
    print(f"   Capítulos: {count_ch}")
    print(f"   Posições: {count_pos}")
    print(f"   Entradas FTS: {fts_count}")

if __name__ == "__main__":
    if not os.path.exists(NESH_FILE):
        print(f"❌ {NESH_FILE} não encontrado.")
    else:
        chapters = parse_nesh_file()
        create_database(chapters)
