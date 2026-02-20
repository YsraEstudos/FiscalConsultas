import sqlite3
import unicodedata
import re

import os

SCRIPT_DIR = os.path.dirname(__file__)
DB_FILE = os.path.join(SCRIPT_DIR, "..", "database", "nesh.db")


def normalize_text(text):
    if not text:
        return ""
    # Remove accents
    text = unicodedata.normalize("NFKD", text).encode("ASCII", "ignore").decode("utf-8")
    text = text.lower()
    # Remove special chars but keep spaces
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    # Remove extra spaces
    return " ".join(text.split())


def setup_fulltext():
    print("Connecting to database...")
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # Drop existing index if any
    cursor.execute("DROP TABLE IF EXISTS search_index")

    # Create FTS5 virtual table
    # columns: ncm, description (normalized), display_text (original), type (chapter/pos)
    print("Creating FTS5 table...")
    cursor.execute("""
        CREATE VIRTUAL TABLE search_index USING fts5(
            ncm, 
            description, 
            display_text, 
            type
        )
    """)

    print("Indexing Data...")

    # 1. Index Chapters
    cursor.execute("SELECT chapter_num, content FROM chapters")
    chapters = cursor.fetchall()
    print(f"Indexing {len(chapters)} chapters...")

    for cap in chapters:
        num = cap[0]
        content = cap[1]

        # Clean content slightly for better search (kept generic)
        normalized_content = normalize_text(content)

        cursor.execute(
            "INSERT INTO search_index (ncm, description, display_text, type) VALUES (?, ?, ?, ?)",
            (num, normalized_content, f"Capítulo {num}", "chapter"),
        )

    # 2. Index Positions (More granular)
    cursor.execute("SELECT codigo, descricao FROM positions")
    positions = cursor.fetchall()
    print(f"Indexing {len(positions)} positions...")

    for pos in positions:
        code = pos[0]
        desc = pos[1]

        normalized_desc = normalize_text(desc)

        cursor.execute(
            "INSERT INTO search_index (ncm, description, display_text, type) VALUES (?, ?, ?, ?)",
            (code, normalized_desc, desc, "position"),
        )

    conn.commit()
    conn.close()
    print("✅ Indexing Complete!")


if __name__ == "__main__":
    setup_fulltext()
