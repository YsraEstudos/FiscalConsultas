"""
Testes para validar que o TipiRenderer aplica highlight de unidades de medida.
"""
import re
from backend.presentation.tipi_renderer import TipiRenderer


def test_tipi_render_position_highlights_units():
    """render_position deve realçar unidades de medida na descrição."""
    pos = {
        'codigo': '84.14',
        'ncm': '8414',
        'descricao': 'Compressor de 10 kW e capacidade de 500 litros',
        'aliquota': '10',
        'nivel': 1
    }
    
    html = TipiRenderer.render_position(pos)
    
    # Deve conter highlight-unit para kW e litros
    assert 'highlight-unit' in html
    assert 'class="highlight-unit">kW<' in html
    assert re.search(r'class="highlight-unit">litros?<', html)


def test_tipi_render_text_results_highlights_units():
    """render_text_results deve realçar unidades de medida."""
    results = [
        {
            'ncm': '8516.10',
            'capitulo': '85',
            'descricao': 'Aquecedor elétrico de 1500 W com 20 litros',
            'aliquota': '5'
        }
    ]
    
    html = TipiRenderer.render_text_results(results)
    
    # Deve conter highlight-unit
    assert 'highlight-unit' in html
    assert 'class="highlight-unit">W<' in html


def test_tipi_render_position_no_units_no_highlight():
    """Descrições sem unidades não devem ter span de highlight."""
    pos = {
        'codigo': '01.01',
        'ncm': '0101',
        'descricao': 'Cavalos vivos',
        'aliquota': '0',
        'nivel': 1
    }
    
    html = TipiRenderer.render_position(pos)
    
    # Não deve conter highlight-unit
    assert 'highlight-unit' not in html


def test_tipi_render_empty_description():
    """Descrição vazia não deve causar erro."""
    pos = {
        'codigo': '01.01',
        'ncm': '0101',
        'descricao': '',
        'aliquota': '0',
        'nivel': 1
    }
    
    html = TipiRenderer.render_position(pos)
    
    # Deve renderizar sem erro
    assert 'tipi-desc' in html
