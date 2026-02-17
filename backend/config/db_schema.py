CHAPTER_NOTES_TABLE = "chapter_notes"

CHAPTER_NOTES_COLUMNS = (
    "chapter_num",
    "notes_content",
    "titulo",
    "notas",
    "consideracoes",
    "definicoes",
    "parsed_notes_json",
)

CHAPTER_NOTES_SECTION_COLUMNS = (
    "titulo",
    "notas",
    "consideracoes",
    "definicoes",
)

CHAPTER_NOTES_CREATE_SQL = f"""
    CREATE TABLE {CHAPTER_NOTES_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_num TEXT UNIQUE NOT NULL,
        notes_content TEXT,
        titulo TEXT,
        notas TEXT,
        consideracoes TEXT,
        definicoes TEXT,
        parsed_notes_json TEXT,
        FOREIGN KEY (chapter_num) REFERENCES chapters(chapter_num)
    )
"""

CHAPTER_NOTES_INSERT_SQL = (
    f"INSERT INTO {CHAPTER_NOTES_TABLE} "
    f"({', '.join(CHAPTER_NOTES_COLUMNS)}) "
    f"VALUES ({', '.join(['?'] * len(CHAPTER_NOTES_COLUMNS))})"
)
