"""DDL helpers for the services catalog SQLite database."""

CATALOG_METADATA_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS catalog_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
)
"""

NBS_ITEMS_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS nbs_items (
    code TEXT PRIMARY KEY,
    code_clean TEXT NOT NULL,
    description TEXT NOT NULL,
    description_normalized TEXT NOT NULL,
    parent_code TEXT NULL REFERENCES nbs_items(code),
    level INTEGER NOT NULL,
    source_order INTEGER NOT NULL,
    sort_path TEXT NOT NULL,
    has_nebs INTEGER NOT NULL DEFAULT 0 CHECK (has_nebs IN (0, 1))
)
"""

NEBS_ENTRIES_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS nebs_entries (
    code TEXT PRIMARY KEY REFERENCES nbs_items(code),
    code_clean TEXT NOT NULL,
    title TEXT NOT NULL,
    title_normalized TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_markdown TEXT NULL,
    body_normalized TEXT NOT NULL,
    section_title TEXT NULL,
    page_start INTEGER NOT NULL,
    page_end INTEGER NOT NULL,
    parser_status TEXT NOT NULL CHECK (parser_status IN ('trusted', 'suspect', 'rejected')),
    parse_warnings TEXT NULL,
    source_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

NEBS_ENTRIES_FTS_CREATE_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS nebs_entries_fts USING fts5 (
    code,
    title,
    body_text,
    section_title,
    tokenize = 'unicode61 remove_diacritics 2'
)
"""

SERVICES_INDEXES_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_nbs_items_code_clean ON nbs_items(code_clean)",
    "CREATE INDEX IF NOT EXISTS idx_nbs_items_parent_source ON nbs_items(parent_code, source_order)",
    "CREATE INDEX IF NOT EXISTS idx_nbs_items_description_normalized ON nbs_items(description_normalized)",
    "CREATE INDEX IF NOT EXISTS idx_nebs_entries_code_clean ON nebs_entries(code_clean)",
    "CREATE INDEX IF NOT EXISTS idx_nebs_entries_status_code ON nebs_entries(parser_status, code)",
    "CREATE INDEX IF NOT EXISTS idx_nebs_entries_title_normalized ON nebs_entries(title_normalized)",
    "CREATE INDEX IF NOT EXISTS idx_nebs_entries_body_normalized ON nebs_entries(body_normalized)",
)
