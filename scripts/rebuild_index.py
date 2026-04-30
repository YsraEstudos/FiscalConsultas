"""
Script de reconstrução do índice com Stemming (Fase 5).
Recria o banco de dados incluindo a tabela FTS5 com textos processados.
"""

import json
import logging
import os
import re
import sqlite3
import sys

# Adiciona diretório pai ao path para importar utils
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.config.db_schema import (
    CHAPTER_NOTES_COLUMNS,
    CHAPTER_NOTES_CREATE_SQL,
    CHAPTER_NOTES_INSERT_SQL,
)
from backend.utils.nesh_sections import extract_chapter_sections
from backend.utils.text_processor import NeshTextProcessor

# Configura logging básico apenas quando não houver configuração prévia.
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

# Configuração
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
NESH_FILE = os.path.join(SCRIPT_DIR, "..", "data", "debug_nesh", "Nesh.txt")
DB_FILE = os.path.join(SCRIPT_DIR, "..", "database", "nesh.db")
CONFIG_FILE = os.path.join(SCRIPT_DIR, "..", "backend", "config", "settings.json")
logger = logging.getLogger(__name__)

# Carrega Stopwords
try:
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        config = json.load(f)
        stopwords = config.get("search", {}).get("stopwords", [])
except Exception:
    logger.warning(
        "Falha ao carregar stopwords de %s; seguindo com lista vazia",
        CONFIG_FILE,
        exc_info=True,
    )
    stopwords = []

processor = NeshTextProcessor(stopwords)


def extract_positions_from_chapter(chapter_content: str) -> list:
    # Match: 01.01 - or **01.01 -**, including hyphen/en-dash/em-dash
    position_pattern = r"^\s*(?:\*\*)?(\d{2}\.\d{2})(?:\*\*)?\s*[\-–—]\s*"
    positions = []

    for line in chapter_content.split("\n"):
        match = re.match(position_pattern, line.strip())
        if match:
            pos = match.group(1)
            # Handle description after dash, potentially removing trailing bold
            desc_match = re.match(
                r"^\s*(?:\*\*)?\d{2}\.\d{2}(?:\*\*)?\s*[\-–—]\s*(.+)", line.strip()
            )
            desc = (
                desc_match.group(1).replace("**", "").replace("*", "").strip()
                if desc_match
                else ""
            )
            # Truncate if too long (database limit check)
            desc = desc[:300]
            positions.append({"codigo": pos, "descricao": desc})

    return positions


def extract_chapter_notes(chapter_content: str) -> str:
    """
    Legacy: Retorna todo conteúdo pré-NCM como string única.
    Mantido para compatibilidade.
    """
    sections = extract_chapter_sections(chapter_content)
    parts = [
        sections["titulo"],
        sections["notas"],
        sections["consideracoes"],
        sections["definicoes"],
    ]
    return "\n\n".join(p for p in parts if p)


def _parse_notes_for_precompute(notes_content: str) -> dict[str, str]:
    """Parse notes at ingestion time to avoid runtime regex."""
    if not notes_content:
        return {}

    pattern = re.compile(r"^(\d+)\s*[\-–—.):]\s*")
    notes: dict[str, str] = {}
    current_num = None
    buffer: list[str] = []

    for line in notes_content.split("\n"):
        cleaned = line.strip()
        match = pattern.match(cleaned)
        if match:
            if current_num:
                notes[current_num] = "\n".join(buffer).strip()
            current_num = match.group(1)
            buffer = [cleaned]
        elif current_num:
            buffer.append(cleaned)

    if current_num:
        notes[current_num] = "\n".join(buffer).strip()

    return notes


def parse_nesh_file():
    print(f"📖 Lendo {NESH_FILE}...")
    with open(NESH_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    # Match: Capítulo 1 or **Capítulo 1** at start of line
    chapter_pattern = r"(?m)^\s*\*{0,2}Capítulo\s+(\d+)\*{0,2}\s*$"
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
        print("🗑️  Banco anterior removido")

    print(f"🔨 Reconstruindo {DB_FILE} com FTS Stemmed...")

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # 1. Tabelas Estruturais
    cursor.execute(
        """
        CREATE TABLE chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_num TEXT UNIQUE NOT NULL,
            content TEXT NOT NULL
        )
    """
    )
    cursor.execute(
        """
        CREATE TABLE positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_num TEXT NOT NULL,
            codigo TEXT NOT NULL,
            descricao TEXT,
            FOREIGN KEY (chapter_num) REFERENCES chapters(chapter_num)
        )
    """
    )
    cursor.execute(CHAPTER_NOTES_CREATE_SQL)

    # 2. Tabela FTS (Busca Textual)
    # ncm: identificador principal (capítulo ou posição)
    # display_text: texto original para exibição (título/descrição)
    # item_type: 'chapter' ou 'position'
    # description: para busca
    # search_index: coluna mágica onde inserimos o texto processado (stemmed)
    cursor.execute(
        """
        CREATE VIRTUAL TABLE search_index USING fts5(
            ncm, 
            display_text, 
            type, 
            description,
            indexed_content
        )
    """
    )

    # Índices Relacionais
    cursor.execute("CREATE INDEX idx_chapter_num ON chapters(chapter_num)")
    cursor.execute("CREATE INDEX idx_position_code ON positions(codigo)")

    count_ch = 0
    count_pos = 0

    for chapter_num, content in sorted(chapters.items()):
        # Insere Capítulo Relacional
        cursor.execute(
            "INSERT INTO chapters (chapter_num, content) VALUES (?, ?)",
            (chapter_num, content),
        )
        count_ch += 1

        # Extrai seções estruturadas
        sections = extract_chapter_sections(content)
        notes = extract_chapter_notes(content)  # Legacy: tudo junto

        if notes or any(sections.values()):
            parsed_notes = _parse_notes_for_precompute(notes)
            values_map = {
                "chapter_num": chapter_num,
                "notes_content": notes,
                "titulo": sections.get("titulo"),
                "notas": sections.get("notas"),
                "consideracoes": sections.get("consideracoes"),
                "definicoes": sections.get("definicoes"),
                "parsed_notes_json": (
                    json.dumps(parsed_notes, ensure_ascii=False)
                    if parsed_notes
                    else None
                ),
            }
            cursor.execute(
                CHAPTER_NOTES_INSERT_SQL,
                [values_map[col] for col in CHAPTER_NOTES_COLUMNS],
            )

        # --- FTS para o Capítulo ---
        # Indexamos o conteúdo inteiro do capítulo? Ou só notas e título?
        # Para busca melhor, vamos indexar o capítulo inteiro, processado.

        # Limpa o conteúdo para não poluir o índice com formatação
        clean_content = re.sub(r"Página \d+\r?\n", "", content)
        processed_content = processor.process(clean_content)

        cursor.execute(
            """
            INSERT INTO search_index (ncm, display_text, type, description, indexed_content) 
            VALUES (?, ?, ?, ?, ?)
        """,
            (
                chapter_num,
                f"Capítulo {chapter_num}",
                "chapter",
                content[:200],  # Descrição curta sem stem
                processed_content,  # TEXTO BUSCÁVEL STEMMED
            ),
        )

        # --- Posições ---
        vals_pos = extract_positions_from_chapter(content)
        for pos in vals_pos:
            cursor.execute(
                "INSERT INTO positions (chapter_num, codigo, descricao) VALUES (?, ?, ?)",
                (chapter_num, pos["codigo"], pos["descricao"]),
            )

            # FTS para Posição
            processed_desc = processor.process(pos["descricao"])
            cursor.execute(
                """
                INSERT INTO search_index (ncm, display_text, type, description, indexed_content) 
                VALUES (?, ?, ?, ?, ?)
            """,
                (
                    pos["codigo"],
                    f"{pos['codigo']} - {pos['descricao']}",
                    "position",
                    pos["descricao"],
                    processed_desc,
                ),
            )
            count_pos += 1

    conn.commit()

    # Verify FTS
    cursor.execute("SELECT count(*) FROM search_index")
    fts_count = cursor.fetchone()[0]

    conn.close()
    print("✅ Banco recriado com sucesso!")
    print(f"   Capítulos: {count_ch}")
    print(f"   Posições: {count_pos}")
    print(f"   Entradas FTS: {fts_count}")


if __name__ == "__main__":
    if not os.path.exists(NESH_FILE):
        print(f"❌ {NESH_FILE} não encontrado.")
    else:
        chapters = parse_nesh_file()
        create_database(chapters)
