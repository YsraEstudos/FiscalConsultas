import os
import sqlite3
import tempfile
from pathlib import Path

import pytest
from backend.presentation.tipi_renderer import TipiRenderer
from backend.presentation.renderer import HtmlRenderer
from backend.services.tipi_service import TipiService


@pytest.fixture(autouse=True)
def _neutralize_renderer_highlights(monkeypatch):
    monkeypatch.setattr(HtmlRenderer, "inject_exclusion_highlights", lambda text: text)
    monkeypatch.setattr(HtmlRenderer, "inject_unit_highlights", lambda text: text)


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
        resp = await svc.searchTipiByNcmCode("85")
        await svc.closeTipiConnectionPool()  # Good practice to close

        html = TipiRenderer.render_full_response(resp["resultados"])

        assert 'id="cap-85"' in html
        assert 'id="pos-85-17"' in html
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


@pytest.mark.unit
@pytest.mark.parametrize(
    ("aliquota", "expected_class"),
    [
        ("", "aliquot-zero"),
        ("0", "aliquot-zero"),
        ("0%", "aliquot-zero"),
        ("NT", "aliquot-nt"),
        ("3", "aliquot-low"),
        ("7", "aliquot-med"),
        ("12", "aliquot-high"),
        ("abc", "aliquot-zero"),
    ],
)
def test_get_aliquot_class_covers_all_ranges(aliquota: str, expected_class: str) -> None:
    assert TipiRenderer.get_aliquot_class(aliquota) == expected_class


@pytest.mark.unit
def test_render_position_and_chapter_variants() -> None:
    position_html = TipiRenderer.render_position(
        {
            "codigo": "85.17",
            "descricao": "Aparelho telefônico",
            "aliquota": "7",
            "nivel": 8,
        }
    )
    assert 'id="pos-85-17"' in position_html
    assert 'tipi-nivel-5' in position_html
    assert 'data-tooltip="Alíquota Média (6-10%)"' in position_html
    assert ">7%<" in position_html

    empty_aliquota_html = TipiRenderer.render_position(
        {
            "ncm": "85.18",
            "descricao": "Outro item",
            "aliquota": "",
            "nivel": 0,
        }
    )
    assert 'aria-label="NCM 85.18"' in empty_aliquota_html
    assert 'tipi-nivel-0' in empty_aliquota_html

    chapter_html = TipiRenderer.render_chapter(
        {"capitulo": "85", "titulo": "Capítulo 85", "posicoes": []}
    )
    assert 'id="cap-85"' in chapter_html
    assert "Capítulo 85" in chapter_html


@pytest.mark.unit
def test_render_full_response_and_text_results_handle_empty_and_populated_inputs() -> None:
    assert (
        TipiRenderer.render_full_response({})
        == '<p class="empty">Nenhum resultado encontrado na TIPI.</p>'
    )
    assert (
        TipiRenderer.render_text_results([])
        == '<p class="empty">Nenhum resultado encontrado.</p>'
    )

    full_html = TipiRenderer.render_full_response(
        {
            "85": {
                "capitulo": "85",
                "titulo": "Capítulo 85",
                "posicoes": [
                    {
                        "codigo": "85.17",
                        "descricao": "Aparelho telefônico",
                        "aliquota": "NT",
                        "nivel": 1,
                    }
                ],
            }
        }
    )
    assert 'id="cap-85"' in full_html
    assert 'aliquot-nt' in full_html

    text_html = TipiRenderer.render_text_results(
        [
            {
                "ncm": "85.17",
                "capitulo": "85",
                "descricao": "Aparelho telefônico",
                "aliquota": "0",
            }
        ]
    )
    assert 'class="tipi-results-list"' in text_html
    assert 'data-ncm="85.17"' in text_html
    assert ">0%<" in text_html
