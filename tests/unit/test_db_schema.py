from backend.config.db_schema import (
    CHAPTER_NOTES_COLUMNS,
    CHAPTER_NOTES_SECTION_COLUMNS,
)


def test_chapter_notes_columns_include_sections():
    assert CHAPTER_NOTES_COLUMNS[0] == "chapter_num"
    assert "notes_content" in CHAPTER_NOTES_COLUMNS
    for col in CHAPTER_NOTES_SECTION_COLUMNS:
        assert col in CHAPTER_NOTES_COLUMNS


def test_chapter_notes_columns_unique():
    assert len(set(CHAPTER_NOTES_COLUMNS)) == len(CHAPTER_NOTES_COLUMNS)
