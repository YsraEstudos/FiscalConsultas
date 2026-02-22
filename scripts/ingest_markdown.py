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

    for i, line in enumerate(lines):
        line_clean = line.strip()
        match = chapter_start_re.match(line_clean)

        if match:
            new_chap_num = int(match.group(1))

            # Helper for creating/updating
            if current_chapter is not None:
                # Save previous chapter
                save_chapter(cursor, current_chapter, buffer)
                chapters_written += 1

            # Logic to handle duplicates/index:
            # We enforce strictly ascending order mostly, but allow gaps (missing chaps)
            # If we see a lower number than max_seen, assume it's garbage/index and ignore switching
            # UNLESS it's the first time we see it?
            # Actually, "found 156 chapters" implies duplicates.
            # Use strict ascending logic: Only switch if new_chap >= max_chapter_seen?
            # Or distinct chapters?

            # Let's assume the main content comes first (Line 1000+).
            # If we see Chapter 1 at line 120000 again, ignore.

            if new_chap_num < max_chapter_seen:
                # Likely index/reference at end of file
                # Don't switch current_chapter, treat this line as content of current_chapter?
                # adhere to "buffer.append(line)" below?
                # Ideally we stop being in "capture mode" for that header, but it's just one line.
                # But wait, if it's "Capítulo 1" in an index, the NEXT lines might be index content.
                # So we might append index content to the *previous* chapter (e.g. Chapter 97).
                # That's acceptable.
                pass
            else:
                if new_chap_num == 73:
                    print("DEBUG: ENTERING CHAPTER 73")

                current_chapter = new_chap_num
                max_chapter_seen = new_chap_num
                buffer = []  # Start fresh for this chapter
                # Optional: Skip the "Capítulo X" line itself in the content?
                # Renderer adds its own header.
                continue

        if current_chapter is not None:
            # Sanitize line before adding

            # Filter out standalone NCM codes (e.g. "73.24", "**73.24**", "7324.10") that don't have descriptions
            # Pattern: start, optional stars, digits(2 or 4).digits(2 or 0), optional extensions, optional stars, end
            if re.match(
                r"^\s*(?:\*\*)?(?:\d{4}|\d{2}\.\d{2})(?:\.\d{2})?(?:\.\d{2})?(?:\*\*)?\s*$",
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
        "CREATE TABLE positions (codigo TEXT PRIMARY KEY, descricao TEXT, chapter_num TEXT, anchor_id TEXT)"
    )

    # Select all chapters and parse them
    cursor.execute("SELECT chapter_num, content FROM chapters")
    rows = cursor.fetchall()

    # Regex to find NCMs in content: **73.24 - ...** or 73.24 - ...
    # Capture Group 1: Code, Group 2: Desc
    ncm_pattern = re.compile(
        r"^\s*(?:\*\*)?(\d{2}\.\d{2}(?:\.\d{2})?(?:\.\d{2})?)(?:\*\*)?\s*[-–—:]\s*(.+?)(?:\*\*)?\s*$",
        re.MULTILINE,
    )

    pos_count = 0
    for num, content in rows:
        if num == "73" or num == 73:
            # print(f"DEBUG CH73 CONTENT (First 200 chars): {repr(content[:200])}")
            pass

        matches = ncm_pattern.findall(content)

        for code, desc in matches:
            # Clean desc (remove markdown stars if any remain, though regex handles outer ones)
            desc = desc.strip()
            # If desc ends with **, remove it (regex (?:\*\*)? at end should handle, but be safe)
            if desc.endswith("**"):
                desc = desc[:-2]

            try:
                # Ensure chapter_num is string formatted '01', '85', etc.
                chap_str = str(num).zfill(2)
                anchor_id = "pos-" + code.replace(".", "-")
                cursor.execute(
                    "INSERT OR IGNORE INTO positions (codigo, descricao, chapter_num, anchor_id) VALUES (?, ?, ?, ?)",
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
