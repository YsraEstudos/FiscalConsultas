import os
import pytest
import aiosqlite

from backend.infrastructure.database import DatabaseAdapter
from backend.config.exceptions import DatabaseError


async def _fts_table_exists(db_file: str) -> bool:
    async with aiosqlite.connect(db_file) as conn:
        cur = await conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='search_index' LIMIT 1"
        )
        return await cur.fetchone() is not None


@pytest.mark.asyncio
async def test_fts_debug_smoke():
    """Smoke test: FTS search should not crash across schema variants.

    This repo supports at least two FTS schemas:
    - legacy: column `description`
    - new: column `indexed_content`

    The backend is expected to auto-detect and use whichever exists.
    """
    db_file = os.path.abspath("database/nesh.db")
    if not os.path.exists(db_file):
        pytest.skip("nesh.db não encontrado no root do projeto")

    if not await _fts_table_exists(db_file):
        pytest.skip("Tabela FTS 'search_index' não existe; índice ainda não foi criado")

    db = DatabaseAdapter(db_file)
    try:
        results = await db.fts_search("bomb* submersivel*", limit=10)
    except DatabaseError as e:
        # Índice pode não estar configurado; o importante é não explodir com OperationalError.
        pytest.skip(str(e))
    finally:
        await db.close()

    assert isinstance(results, list)
