import os
import re
import sqlite3

INPUT_FILE = "raw_data/nesh.md"
DB_FILE = "database/nesh.db"

CHAPTER_START_RE = re.compile(
    r"^\s*(?:\*\*)?\s*Capítulo\s+(\d+)(?:\*\*)?\s*$", re.IGNORECASE
)
STANDALONE_CODE_RE = re.compile(
    r"^\s*(?:\*\*)?(?:\d{4}|\d{2}\.\d{2})(?:\.\d{2})?(?:\.\d{2})?(?:\*\*)?\s*$"
)
NCM_CODE_RE = re.compile(r"^\d{2}\.\d{2}(?:\.\d{2}){0,2}$")


def _strip_markdown_bold(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("**"):
        stripped = stripped[2:].lstrip()
    if stripped.endswith("**"):
        stripped = stripped[:-2].rstrip()
    return stripped


def _parse_ncm_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped:
        return None

    first_sep_idx = -1
    for sep in ("-", "–", "—", ":"):
        idx = stripped.find(sep)
        if idx > 0 and (first_sep_idx == -1 or idx < first_sep_idx):
            first_sep_idx = idx

    if first_sep_idx <= 0:
        return None

    description_start = first_sep_idx + 1
    code = _strip_markdown_bold(stripped[:first_sep_idx])
    description = _strip_markdown_bold(stripped[description_start:])

    if not NCM_CODE_RE.fullmatch(code):
        return None
    if not description:
        return None

    return code, description


def ingest_markdown():
    print(f"Reading {INPUT_FILE}...")

    if not os.path.exists(INPUT_FILE):
        print(f"Error: {INPUT_FILE} not found.")
        return

    with open(INPUT_FILE, "r", encoding="utf-8-sig") as f:
        lines = f.readlines()

    print(f"Total lines: {len(lines)}")

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    current_chapter = None
    buffer = []

    chapters_written = 0
    max_chapter_seen = 0

    for line in lines:
        line_clean = line.strip()
        match = CHAPTER_START_RE.match(line_clean)

        if match:
            new_chap_num = int(match.group(1))
            if new_chap_num < max_chapter_seen:
                # Header fora de ordem costuma ser índice/referência no fim do arquivo.
                # Interrompemos para não contaminar o capítulo atual.
                break

            if current_chapter == new_chap_num:
                # Header duplicado do mesmo capítulo.
                continue

            if current_chapter is not None:
                # Só salva capítulo anterior depois de validar que houve troca válida.
                save_chapter(cursor, current_chapter, buffer)
                chapters_written += 1

            current_chapter = new_chap_num
            max_chapter_seen = new_chap_num
            buffer = []  # Start fresh for this chapter
            continue

        if current_chapter is not None:
            # Sanitize line before adding

            # Filter out standalone NCM codes (e.g. "73.24", "**73.24**", "7324.10") that don't have descriptions  # noqa: E501
            # Pattern: start, optional stars, digits(2 or 4).digits(2 or 0), optional extensions, optional stars, end  # noqa: E501
            if STANDALONE_CODE_RE.match(line_clean):
                continue

            buffer.append(line)

    # Save last chapter
    if current_chapter is not None:
        save_chapter(cursor, current_chapter, buffer)
        chapters_written += 1

    # Re-populate positions table from the new clean content
    print("Re-populating positions table...")
    cursor.execute("DROP TABLE IF EXISTS positions")
    cursor.execute(
        "CREATE TABLE positions (codigo TEXT PRIMARY KEY, descricao TEXT, chapter_num TEXT, anchor_id TEXT)"  # noqa: E501
    )

    # Select all chapters and parse them
    cursor.execute("SELECT chapter_num, content FROM chapters")
    rows = cursor.fetchall()

    pos_count = 0
    for num, content in rows:
        if num == "73" or num == 73:
            # print(f"DEBUG CH73 CONTENT (First 200 chars): {repr(content[:200])}")
            pass

        for raw_line in content.splitlines():
            parsed = _parse_ncm_line(raw_line)
            if not parsed:
                continue
            code, desc = parsed

            try:
                # Ensure chapter_num is string formatted '01', '85', etc.
                chap_str = str(num).zfill(2)
                anchor_id = "pos-" + code.replace(".", "-")
                cursor.execute(
                    "INSERT OR IGNORE INTO positions (codigo, descricao, chapter_num, anchor_id) VALUES (?, ?, ?, ?)",  # noqa: E501
                    (code, desc, chap_str, anchor_id),
                )
                pos_count += 1
            except sqlite3.Error as e:
                print(f"Error inserting {code}: {e}")

    print(f"✅ Extracted and inserted {pos_count} positions.")

    conn.commit()
    conn.close()
    print(f"✅ Ingestion complete. Updated {chapters_written} chapters.")


def save_chapter(cursor, chap_num, buffer):
    content = "".join(buffer).strip()
    chap_str = str(chap_num).zfill(2)  # "01", "73"

    print(f"SAVING CH{chap_str}: {len(buffer)} lines, {len(content)} chars.")

    # Ensure chapter exists
    # content = re.sub(r'^\s*XV-\d{4}-\d+\s*$', '', content, flags=re.MULTILINE)

    # Ensure chapter exists
    cursor.execute("DELETE FROM chapters WHERE chapter_num = ?", (chap_str,))
    cursor.execute(
        "INSERT INTO chapters (chapter_num, content) VALUES (?, ?)", (chap_str, content)
    )


if __name__ == "__main__":
    ingest_markdown()
