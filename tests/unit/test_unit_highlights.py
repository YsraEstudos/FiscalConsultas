import re

from backend.presentation.renderer import HtmlRenderer


def test_unit_highlight_does_not_match_portuguese_article_um_or_preposition_a():
    # "um" não pode ser tratado como unidade (alias ruim de µm)
    text = "um núcleo a 37,5 W"
    out = HtmlRenderer.inject_unit_highlights(text)
    assert 'class="highlight-unit">um<' not in out
    assert 'class="highlight-unit">a<' not in out


def test_unit_highlight_matches_common_units_after_number():
    text = "10.000 kVA 37,5 W 220 V 10 A 25 °C 2 litros 3 m³/h"
    out = HtmlRenderer.inject_unit_highlights(text)
    # unidades longas
    assert 'highlight-unit">kVA<' in out
    assert 'highlight-unit">°C<' in out
    assert re.search(r'highlight-unit">litros?<', out)
    assert 'highlight-unit">m³/h<' in out or 'highlight-unit">m3/h<' in out
    # unidades de 1 letra só após número
    assert 'highlight-unit">W<' in out
    assert 'highlight-unit">V<' in out
    assert 'highlight-unit">A<' in out


def test_unit_highlight_ignores_units_inside_smart_links():
    html = (
        'fora 37,5 W '
        '<a href="#" class="smart-link" data-ncm="8516">dentro 10 kW</a> '
        'fora 10 kW'
    )
    out = HtmlRenderer.inject_unit_highlights(html)
    # fora do link deve destacar
    assert out.count('highlight-unit') >= 2
    # dentro do smart-link NÃO deve destacar
    assert 'smart-link" data-ncm="8516">dentro 10 <span class="highlight-unit">kW</span>' not in out
