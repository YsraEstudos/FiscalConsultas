import sqlite3

import pytest

from backend.infrastructure.database import DatabaseAdapter


def _create_legacy_db_without_anchor_id(path: str) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """
            CREATE TABLE chapters (
                chapter_num TEXT PRIMARY KEY,
                content TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE positions (
                codigo TEXT PRIMARY KEY,
                chapter_num TEXT NOT NULL,
                descricao TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE chapter_notes (
                chapter_num TEXT UNIQUE NOT NULL,
                notes_content TEXT
            )
            """
        )

        conn.execute(
            "INSERT INTO chapters (chapter_num, content) VALUES (?, ?)",
            ("84", "Capitulo 84 - Maquinas e aparelhos mecanicos."),
        )
        conn.execute(
            "INSERT INTO positions (codigo, chapter_num, descricao) VALUES (?, ?, ?)",
            ("84.13", "84", "Bombas para liquidos"),
        )
        conn.execute(
            "INSERT INTO chapter_notes (chapter_num, notes_content) VALUES (?, ?)",
            ("84", "Notas do capitulo 84."),
        )
        conn.commit()
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_get_chapter_raw_supports_legacy_positions_without_anchor_id(tmp_path):
    db_file = tmp_path / "legacy_nesh.db"
    _create_legacy_db_without_anchor_id(str(db_file))

    db = DatabaseAdapter(str(db_file))
    try:
        chapter = await db.get_chapter_raw("84")
    finally:
        await db.close()

    assert chapter is not None
    assert chapter["chapter_num"] == "84"
    assert chapter["positions"] == [
        {"codigo": "84.13", "descricao": "Bombas para liquidos", "anchor_id": None}
    ]
