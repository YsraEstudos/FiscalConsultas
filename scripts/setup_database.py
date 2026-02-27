"""
Script de instalação - Converte Nesh.txt (ou .zip) para banco de dados SQLite.
Inclui validação de hash para evitar processamento redundante e compressão automática.
"""

import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import zipfile

try:
    from backend.config.db_schema import (
        CHAPTER_NOTES_COLUMNS,
        CHAPTER_NOTES_CREATE_SQL,
        CHAPTER_NOTES_INSERT_SQL,
    )
    from backend.utils.nesh_sections import extract_chapter_sections
except ModuleNotFoundError:
    # Allow running this script from the scripts/ directory.
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from backend.config.db_schema import (
        CHAPTER_NOTES_COLUMNS,
        CHAPTER_NOTES_CREATE_SQL,
        CHAPTER_NOTES_INSERT_SQL,
    )
    from backend.utils.nesh_sections import extract_chapter_sections


def _parse_notes_for_precompute(notes_content: str) -> dict:
    """Parse notes at ingestion time to avoid runtime regex."""
    if not notes_content:
        return {}
    import re as _re

    pattern = _re.compile(r"^(\d+)\s*[\-–—.):]\s*")
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
        else:
            if current_num:
                buffer.append(cleaned)
    if current_num:
        notes[current_num] = "\n".join(buffer).strip()
    return notes


# Caminhos dos arquivos
SCRIPT_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "data")
NESH_TXT = os.path.join(DATA_DIR, "Nesh.txt")
NESH_ZIP = os.path.join(DATA_DIR, "Nesh.zip")
DB_FILE = os.path.join(SCRIPT_DIR, "..", "database", "nesh.db")


def calculate_content_hash(content: str) -> str:
    """Calcula o hash SHA-256 do conteúdo."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def get_current_db_hash() -> str | None:
    """Retorna o hash armazenado no banco de dados atual, se existir."""
    if not os.path.exists(DB_FILE):
        return None

    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM metadata WHERE key='content_hash'")
        result = cursor.fetchone()
        conn.close()
        return result[0] if result else None
    except (sqlite3.OperationalError, sqlite3.DatabaseError):
        return None


def read_nesh_content() -> tuple[str | None, str | None, str | None]:
    """
    Read the Nesh source content, preferring a plain TXT file over a ZIP archive.
    
    Returns:
        tuple[str | None, str | None, str | None]: A tuple (content, source_type, source_path)
            - content: the file content as a UTF-8 string, or `None` if no readable source was found.
            - source_type: `"txt"` if read from Nesh.txt, `"zip"` if read from a .txt inside Nesh.zip, or `None` if not found.
            - source_path: filesystem path to the source used (NESH_TXT or NESH_ZIP), or `None` if not found.
    Notes:
        - If a ZIP is used, the first `.txt` file found inside the archive is returned.
        - If the ZIP file is corrupted, the function returns `(None, None, None)`.
    """
    # 1. Tenta ler TXT
    if os.path.exists(NESH_TXT):
        print(f"📖 Lendo {NESH_TXT}...")
        with open(NESH_TXT, "r", encoding="utf-8") as txt_file:
            return txt_file.read(), "txt", NESH_TXT

    # 2. Tenta ler ZIP
    if os.path.exists(NESH_ZIP):
        print(f"📦 Lendo {NESH_ZIP}...")
        try:
            with zipfile.ZipFile(NESH_ZIP, "r") as z:
                # Assume que há apenas um arquivo txt dentro ou pega o primeiro
                file_list = z.namelist()
                txt_files = [f for f in file_list if f.endswith(".txt")]

                if not txt_files:
                    raise FileNotFoundError(
                        "Nenhum arquivo .txt encontrado dentro do zip"
                    )

                target_file = txt_files[0]
                with z.open(target_file) as zip_entry:
                    return zip_entry.read().decode("utf-8"), "zip", NESH_ZIP
        except zipfile.BadZipFile:
            print("❌ Erro: Arquivo ZIP corrompido.")
            return None, None, None

    return None, None, None


def _clean_position_description(desc: str) -> str:
    """
    Clean and normalize a position description extracted from source content.
    
    Performs targeted removals and transformations commonly needed for NESH position text:
    - Removes the NESH "(+)" subposition artifact and Markdown bold markers.
    - Strips a trailing isolated period.
    - Converts PDF-style bracketed superscripts `[2]` and `[3]` to `²` and `³`.
    - Collapses multiple spaces and trims surrounding whitespace.
    
    Returns:
        cleaned (str): The normalized description string.
    """
    # Remove artefato (+) da convenção NESH (indica Nota Explicativa de subposição)
    desc = re.sub(r"\s*\(\+\)\s*", " ", desc)
    # Remove marcadores de bold do markdown (**)
    desc = desc.replace("**", "")
    # Remove ponto final isolado com espaços
    desc = re.sub(r"\s*\.\s*$", "", desc)
    # Converte notação de colchetes do PDF: [3] → ³, [2] → ²
    desc = re.sub(
        r"\s?\[\s*([23])\s*\]",
        lambda m: {"2": "²", "3": "³"}[m.group(1)],
        desc,
    )
    # Normaliza espaços múltiplos
    desc = re.sub(r"\s{2,}", " ", desc).strip()
    return desc


def extract_positions_from_chapter(chapter_content: str) -> list:
    """
    Extracts unique position entries from a chapter's text.
    
    Scans the chapter content for lines that start with a two-digit dot two-digit code (e.g., "01.01" or "85.07") followed by a separator and a description. Accepts codes wrapped in markdown bold markers and different dash characters. For each distinct code, the first occurrence is kept; subsequent duplicates are ignored. Descriptions are cleaned and normalized, then truncated to 100 characters.
    
    Parameters:
        chapter_content (str): Full text of a chapter to scan for position lines.
    
    Returns:
        list[dict]: A list of dictionaries in the order found, each with:
            - "codigo" (str): The position code (e.g., "01.01").
            - "descricao" (str): The cleaned, truncated description for that code.
    """
    # Aceita linhas com **bold** e diferentes tipos de hífen
    position_pattern = r"^\s*(?:\*\*)?(\d{2}\.\d{2})(?:\*\*)?\s*[\-–—]\s*"
    positions = []
    seen_codes: set[str] = set()

    for line in chapter_content.split("\n"):
        match = re.match(position_pattern, line)
        if match:
            pos = match.group(1)
            # Evita duplicatas: pega apenas a primeira ocorrência de cada código
            if pos in seen_codes:
                continue
            seen_codes.add(pos)
            desc_match = re.match(
                r"^\s*(?:\*\*)?\d{2}\.\d{2}(?:\*\*)?\s*[\-–—]\s*(.+)", line
            )
            raw_desc = desc_match.group(1) if desc_match else ""
            desc = _clean_position_description(raw_desc)[:100]
            positions.append({"codigo": pos, "descricao": desc})

    return positions


def extract_chapter_notes(chapter_content: str) -> str:
    """
    Extracts the general notes section for a chapter.
    
    Parses the text between the chapter title and the first position entry. Recognizes an explicit "Nota" or "Notas" header, or treats initial non-position text before the first position code (format "DD.DD -") as the notes section. Collapses runs of three or more consecutive newlines into two and trims leading/trailing whitespace.
    
    Returns:
        notes_text (str): The extracted notes text with normalized blank lines; empty string if no notes were found.
    """
    lines = chapter_content.split("\n")
    notes_lines = []
    notes_started = False

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Pula linhas iniciais (título do capítulo)
        if stripped.startswith("Capítulo ") or not stripped:
            if not notes_started:
                continue

        # Detecta início das notas
        if re.match(r"^Notas?\.?$", stripped, re.IGNORECASE):
            notes_started = True
            notes_lines.append(stripped)
            continue

        # Se ainda não encontrou "Nota." mas é texto antes da primeira posição
        if (
            not notes_started
            and stripped
            and not re.match(r"^\d{2}\.\d{2}\s*-", stripped)
        ):
            # Pode ser título/descrição do capítulo, inclui nas notas
            notes_started = True
            notes_lines.append(stripped)
            continue

        # Detecta fim das notas (primeira posição do tipo XX.XX -)
        if re.match(r"^\d{2}\.\d{2}\s*-", stripped):
            break

        # Coleta linhas das notas
        if notes_started:
            notes_lines.append(stripped)

    # Limpa linhas vazias extras
    notes_text = "\n".join(notes_lines)
    notes_text = re.sub(r"\n{3,}", "\n\n", notes_text)

    return notes_text.strip()


def _sanitize_source_content(content: str) -> str:
    """
    Normalize PDF-extraction artifacts in source text by converting bracketed numeric superscripts to their Unicode superscript characters.
    
    This replaces occurrences like "[2]", "[2 ]", "[ 3]" with the corresponding superscript digits (² and ³), preserving surrounding text.
    
    Parameters:
        content (str): Source text to sanitize, typically extracted from a PDF or raw text file.
    
    Returns:
        str: The sanitized text with bracketed superscripts converted to Unicode superscripts.
    """
    superscript_map = {"2": "²", "3": "³"}
    content = re.sub(
        r"\s?\[\s*([23])\s*\]",
        lambda m: superscript_map[m.group(1)],
        content,
    )
    return content


def parse_nesh_content(content: str) -> dict:
    """
    Parse the full Nesh source text into a mapping of chapter numbers to chapter content.
    
    The function sanitizes common PDF-extraction artifacts (for example, bracketed superscripts) before locating chapters by lines like "Capítulo <number>". It also moves standalone "Seção <Roman>" headers that appear immediately after a chapter header into the following chapter to keep section headers with their intended chapter.
    
    Parameters:
        content (str): Full raw Nesh text to parse.
    
    Returns:
        dict: Mapping of two-digit chapter numbers (e.g., "01", "02") to the corresponding chapter text.
    """
    print(f"   Conteúdo: {len(content):,} bytes, {content.count(chr(10)):,} linhas")

    # Sanitiza artefatos de extração PDF (superscripts, etc.)
    content = _sanitize_source_content(content)

    # Padrão para identificar início de capítulos
    chapter_pattern = r"\nCapítulo\s+(\d+)\r?\n"
    matches = list(re.finditer(chapter_pattern, content))

    chapters = {}
    for i, match in enumerate(matches):
        chapter_num = match.group(1).zfill(2)
        start_pos = match.start()

        if i + 1 < len(matches):
            end_pos = matches[i + 1].start()
        else:
            end_pos = len(content)

        chapter_content = content[start_pos:end_pos].strip()
        chapters[chapter_num] = chapter_content

    # Move standalone section headers (e.g., "Seção XI") that appear AFTER the chapter header  # noqa: E501
    # to the next chapter. This avoids cascading moves when a section header was already
    # prefixed to the next chapter.
    section_header_re = re.compile(
        r"^\s*(?:\*\*)?\s*Seção\s+([IVXLCDM]+)\s*(?:\*\*)?\s*$\n?",
        re.IGNORECASE | re.MULTILINE,
    )
    chapter_header_re_template = r"^\s*Capítulo\s+{num}\s*$"
    chapter_keys = sorted(chapters.keys())
    for idx, chap_num in enumerate(chapter_keys[:-1]):
        chap_content = chapters[chap_num]
        if not chap_content:
            continue

        chapter_header_re = re.compile(
            chapter_header_re_template.format(num=int(chap_num)),
            re.IGNORECASE | re.MULTILINE,
        )
        chapter_header_match = chapter_header_re.search(chap_content)
        if not chapter_header_match:
            continue

        # Find the first standalone section header that appears after the chapter header
        section_match = None
        for match in section_header_re.finditer(chap_content):
            if match.start() > chapter_header_match.start():
                section_match = match
                break

        if section_match:
            section_start = section_match.start()
            section_block = chap_content[section_start:].strip()
            chapters[chap_num] = chap_content[:section_start].rstrip()
            next_chap = chapter_keys[idx + 1]
            if section_block:
                chapters[next_chap] = (
                    f"{section_block}\n\n{chapters[next_chap]}".strip()
                )

    print(f"   Encontrados {len(chapters)} capítulos")
    return chapters


def create_database(chapters: dict, content_hash: str):
    """Cria o banco de dados SQLite com os capítulos e metadados."""

    # Remove banco existente
    if os.path.exists(DB_FILE):
        try:
            os.remove(DB_FILE)
            print("🗑️  Banco anterior removido")
        except PermissionError:
            print(
                f"❌ Erro: Não foi possível remover {DB_FILE}. O arquivo pode estar em uso."  # noqa: E501
            )
            return False

    print(f"🔨 Criando {DB_FILE}...")

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # Cria tabelas
    cursor.execute("""
        CREATE TABLE chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_num TEXT UNIQUE NOT NULL,
            content TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_num TEXT NOT NULL,
            codigo TEXT NOT NULL,
            descricao TEXT,
            anchor_id TEXT,
            FOREIGN KEY (chapter_num) REFERENCES chapters(chapter_num)
        )
    """)

    cursor.execute(CHAPTER_NOTES_CREATE_SQL)

    # Tabela de metadados para controle de versão/updates
    cursor.execute("""
        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)

    # Cria índices
    cursor.execute("CREATE INDEX idx_chapter_num ON chapters(chapter_num)")
    cursor.execute("CREATE INDEX idx_position_codigo ON positions(codigo)")
    cursor.execute("CREATE INDEX idx_position_chapter ON positions(chapter_num)")
    cursor.execute("CREATE INDEX idx_notes_chapter ON chapter_notes(chapter_num)")

    # Insere metadados (timestamp e hash)
    # Convertemos o timestamp para string de forma segura
    cursor.execute(
        "INSERT INTO metadata (key, value) VALUES (?, ?)",
        ("last_update", str(time.time())),
    )
    cursor.execute(
        "INSERT INTO metadata (key, value) VALUES (?, ?)",
        ("content_hash", content_hash),
    )

    # Insere capítulos e posições
    total_positions = 0
    for chapter_num, content in sorted(chapters.items()):
        cursor.execute(
            "INSERT INTO chapters (chapter_num, content) VALUES (?, ?)",
            (chapter_num, content),
        )

        # Extrai e insere posições
        positions = extract_positions_from_chapter(content)
        for pos in positions:
            anchor_id = "pos-" + pos["codigo"].replace(".", "-")
            cursor.execute(
                "INSERT INTO positions (chapter_num, codigo, descricao, anchor_id) VALUES (?, ?, ?, ?)",  # noqa: E501
                (chapter_num, pos["codigo"], pos["descricao"], anchor_id),
            )
        total_positions += len(positions)

        # Extrai e insere notas/sections do capítulo
        sections = extract_chapter_sections(content)
        notes = extract_chapter_notes(content)
        if notes or any(sections.values()):
            # Precompute parsed notes as JSON for runtime performance
            parsed_notes = _parse_notes_for_precompute(notes)
            parsed_json = (
                json.dumps(parsed_notes, ensure_ascii=False) if parsed_notes else None
            )
            values_map = {
                "chapter_num": chapter_num,
                "notes_content": notes,
                "titulo": sections.get("titulo"),
                "notas": sections.get("notas"),
                "consideracoes": sections.get("consideracoes"),
                "definicoes": sections.get("definicoes"),
                "parsed_notes_json": parsed_json,
            }
            cursor.execute(
                CHAPTER_NOTES_INSERT_SQL,
                [values_map[col] for col in CHAPTER_NOTES_COLUMNS],
            )

    conn.commit()

    # Estatísticas finais
    cursor.execute("SELECT COUNT(*) FROM chapters")
    num_chapters = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM positions")
    num_positions = cursor.fetchone()[0]

    cursor.execute(
        'SELECT COUNT(*) FROM chapter_notes WHERE notes_content IS NOT NULL AND notes_content != ""'  # noqa: E501
    )
    num_notes = cursor.fetchone()[0]

    db_size = os.path.getsize(DB_FILE)

    conn.close()

    print("\n✅ Banco de dados criado com sucesso!")
    print(f"   📊 Capítulos: {num_chapters}")
    print(f"   📊 Posições NCM: {num_positions}")
    print(f"   📊 Regras Gerais: {num_notes} capítulos com notas")
    print(f"   📊 Tamanho: {db_size:,} bytes ({db_size / 1024 / 1024:.2f} MB)")
    return True


def compress_nesh_file():
    """Compacta Nesh.txt em Nesh.zip e remove o original."""
    if not os.path.exists(NESH_TXT):
        return

    print(f"\n🗜️  Compactando {NESH_TXT} para economizar espaço...")
    try:
        with zipfile.ZipFile(NESH_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(NESH_TXT, arcname="Nesh.txt")

        original_size = os.path.getsize(NESH_TXT)
        compressed_size = os.path.getsize(NESH_ZIP)
        savings = (1 - compressed_size / original_size) * 100

        os.remove(NESH_TXT)
        print(f"✅ Compactação concluída! Economia de {savings:.1f}%")
        print(
            f"   Original: {original_size / 1024 / 1024:.2f} MB -> Zip: {compressed_size / 1024 / 1024:.2f} MB"  # noqa: E501
        )

    except Exception as e:
        print(f"❌ Erro ao compactar: {e}")


def main():
    print("=" * 50)
    print("🚀 Setup Nesh Database")
    print("=" * 50)

    # 1. Lê conteúdo (TXT ou ZIP)
    content, source_type, source_path = read_nesh_content()

    if not content:
        print(f"❌ Erro: Nenhum arquivo fonte encontrado ({NESH_TXT} ou {NESH_ZIP})")
        return

    start_time = time.time()

    # 2. Verifica Hash/Alterações
    print("🔍 Verificando integridade...")
    current_hash = calculate_content_hash(content)
    db_hash = get_current_db_hash()

    if db_hash == current_hash:
        print(
            "\n✨ O banco de dados já está atualizado com a versão mais recente do arquivo."  # noqa: E501
        )
        print("   Nenhuma alteração detectada. Pule o setup.")

        # Se estivermos usando TXT mas o banco já estiver ok, compactamos
        if source_type == "txt":
            compress_nesh_file()

        return

    print("\n🔎 Alteração detectada ou banco inexistente.")
    print(f"   Hash Arquivo: {current_hash[:8]}...")
    print(f"   Hash Banco:   {db_hash[:8] if db_hash else 'Nenhum'}...")

    # 3. Parse e Criação do Banco
    chapters = parse_nesh_content(content)
    success = create_database(chapters, current_hash)

    if success:
        elapsed = time.time() - start_time
        print(f"\n⏱️  Tempo total: {elapsed:.2f} segundos")

        # 4. Compactação Pós-Importação (apenas se fonte foi TXT)
        if source_type == "txt":
            compress_nesh_file()

        print("\n💡 Agora execute 'python Nesh.py' para iniciar o servidor.")


if __name__ == "__main__":
    main()
