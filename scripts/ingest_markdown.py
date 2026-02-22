import os
import re
import sqlite3

INPUT_FILE = "raw_data/nesh.md"
DB_FILE = "database/nesh.db"


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

    # Regex matching "Capítulo 1", "**Capítulo 1**", etc. STRICTLY
    # Must end of line after number (ignoring optional ** and whitespace)
    chapter_start_re = re.compile(
        r"^\s*(?:\*\*)?\s*Capítulo\s+(\d+)(?:\*\*)?\s*$", re.IGNORECASE
    )

    current_chapter = None
    buffer = []

    chapters_written = 0
    max_chapter_seen = 0

    for line in lines:
        line_clean = line.strip()
        match = chapter_start_re.match(line_clean)

        if match:
            new_chap_num = int(match.group(1))
            if new_chap_num < max_chapter_seen:
                # Header fora de ordem costuma ser índice/referência no fim do arquivo.
                # Ignoramos para não contaminar o capítulo atual.
                continue

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
            if re.match(
                r"^\s*(?:\*\*)?(?:\d{4}|\d{2}\.\d{2})(?:\.\d{2})?(?:\.\d{2})?(?:\*\*)?\s*$",  # noqa: E501
                line_clean,
            ):
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

    # Regex to find NCMs in content: **73.24 - ...** or 73.24 - ...
    # Capture Group 1: Code, Group 2: Desc
    ncm_pattern = re.compile(
        r"^\s*(?:\*\*)?(\d{2}\.\d{2}(?:\.\d{2})?(?:\.\d{2})?)(?:\*\*)?\s*[-–—:]\s*(.+?)(?:\*\*)?\s*$",  # noqa: E501
        re.MULTILINE,
    )

    pos_count = 0
    for num, content in rows:
        if num == "73" or num == 73:
            # print(f"DEBUG CH73 CONTENT (First 200 chars): {repr(content[:200])}")
            pass

        matches = ncm_pattern.findall(content)

        for code, desc in matches:
            # Clean desc (remove markdown stars if any remain, though regex handles outer ones)  # noqa: E501
            desc = desc.strip()
            # If desc ends with **, remove it (regex (?:\*\*)? at end should handle, but be safe)  # noqa: E501
            if desc.endswith("**"):
                desc = desc[:-2]

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
