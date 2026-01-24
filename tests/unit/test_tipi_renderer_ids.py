import os
import sqlite3
import tempfile
import pytest
from pathlib import Path

from backend.services.tipi_service import TipiService
from backend.presentation.tipi_renderer import TipiRenderer

@pytest.mark.asyncio
async def test_renderer_outputs_compatible_ids():
    # Setup temporary DB
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    
    try:
        conn = sqlite3.connect(path)
        conn.execute(
            "CREATE TABLE tipi_positions (ncm TEXT, capitulo TEXT, descricao TEXT, aliquota TEXT, nivel INTEGER, ncm_sort TEXT)"
        )
        conn.execute(
            "INSERT INTO tipi_positions (ncm, capitulo, descricao, aliquota, nivel, ncm_sort) VALUES ('85.17', '85', 'Aparelhos telefônicos', '0', 1, '8517')"
        )
        conn.commit()
        conn.close()

        svc = TipiService(db_path=Path(path))
        resp = await svc.search_by_code("85")
        await svc.close() # Good practice to close
        
        html = TipiRenderer.render_full_response(resp["resultados"])

        assert 'id="cap-85"' in html
        assert 'id="pos-85-17"' in html
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
