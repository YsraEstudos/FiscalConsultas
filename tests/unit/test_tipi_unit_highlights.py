"""
Testes para validar que o TipiRenderer aplica highlight de unidades de medida.
Inclui unidades tradicionais e novas unidades expandidas.
"""

import re

import pytest
from backend.presentation.tipi_renderer import TipiRenderer

# ═══════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════


def _make_pos(
    descricao: str,
    codigo: str = "84.14",
    ncm: str = "8414",
    aliquota: str = "10",
    nivel: int = 1,
) -> dict:
    return {
        "codigo": codigo,
        "ncm": ncm,
        "descricao": descricao,
        "aliquota": aliquota,
        "nivel": nivel,
    }


def _make_text_result(
    descricao: str, ncm: str = "8516.10", capitulo: str = "85", aliquota: str = "5"
) -> list[dict]:
    return [
        {"ncm": ncm, "capitulo": capitulo, "descricao": descricao, "aliquota": aliquota}
    ]


def _has_highlight(html: str, unit: str) -> bool:
    return f'class="highlight-unit">{unit}</span>' in html


# ═══════════════════════════════════════════════════════════════════
# 1. render_position — unidades tradicionais
# ═══════════════════════════════════════════════════════════════════


class TestTipiRenderPositionUnits:
    def test_highlights_kw_and_litros(self):
        html = TipiRenderer.render_position(
            _make_pos("Compressor de 10 kW e capacidade de 500 litros")
        )
        assert "highlight-unit" in html
        assert _has_highlight(html, "kW")
        assert re.search(r'class="highlight-unit">litros?<', html)

    def test_no_units_no_highlight(self):
        html = TipiRenderer.render_position(_make_pos("Cavalos vivos"))
        assert "highlight-unit" not in html

    def test_empty_description(self):
        html = TipiRenderer.render_position(_make_pos(""))
        assert "tipi-desc" in html

    @pytest.mark.parametrize(
        "unit", ["kWh", "kVA", "Hz", "rpm", "MPa", "kg", "km", "ha"]
    )
    def test_multi_letter_units_in_position(self, unit: str):
        html = TipiRenderer.render_position(_make_pos(f"Equipamento de 100 {unit}"))
        assert _has_highlight(html, unit), f"'{unit}' deveria ser destacada"

    @pytest.mark.parametrize("unit", ["W", "V", "A", "m", "g", "N", "J"])
    def test_single_letter_units_in_position(self, unit: str):
        html = TipiRenderer.render_position(_make_pos(f"Componente de 50 {unit}"))
        assert _has_highlight(html, unit), f"'{unit}' deveria ser destacada"


# ═══════════════════════════════════════════════════════════════════
# 2. render_text_results — unidades tradicionais
# ═══════════════════════════════════════════════════════════════════


class TestTipiRenderTextResultsUnits:
    def test_highlights_w_and_litros(self):
        html = TipiRenderer.render_text_results(
            _make_text_result("Aquecedor elétrico de 1500 W com 20 litros")
        )
        assert "highlight-unit" in html
        assert _has_highlight(html, "W")

    def test_no_units_no_highlight(self):
        html = TipiRenderer.render_text_results(
            _make_text_result("Animais vivos sem especificação técnica")
        )
        assert "highlight-unit" not in html


# ═══════════════════════════════════════════════════════════════════
# 3. Novas unidades expandidas
# ═══════════════════════════════════════════════════════════════════


class TestTipiNewUnits:
    """Validar que novas unidades funcionam via TipiRenderer."""

    @pytest.mark.parametrize(
        "unit",
        [
            "dB",
            "Ω",
            "kΩ",
            "ohm",
            "µF",
            "pF",
            "kN",
            "daN",
            "kJ",
            "MJ",
            "lm",
            "lux",
            "Btu",
            "psi",
        ],
    )
    def test_new_multi_letter_units_in_position(self, unit: str):
        html = TipiRenderer.render_position(
            _make_pos(f"Especificação técnica de 100 {unit}")
        )
        assert _has_highlight(html, unit), f"'{unit}' deveria ser destacada"

    def test_polegadas_in_position(self):
        html = TipiRenderer.render_position(
            _make_pos("Tubo de 2 polegadas de diâmetro")
        )
        assert _has_highlight(html, "polegadas")

    def test_bar_after_digit_in_position(self):
        html = TipiRenderer.render_position(
            _make_pos("Compressor com pressão de 10 bar")
        )
        assert _has_highlight(html, "bar")

    def test_bar_without_digit_no_highlight(self):
        html = TipiRenderer.render_position(_make_pos("Bar e restaurante"))
        assert "highlight-unit" not in html

    @pytest.mark.parametrize("unit", ["dB", "psi", "Btu", "lm"])
    def test_new_units_in_text_results(self, unit: str):
        html = TipiRenderer.render_text_results(
            _make_text_result(f"Produto com especificação de 50 {unit}")
        )
        assert _has_highlight(
            html, unit
        ), f"'{unit}' deveria ser destacada em text_results"


# ═══════════════════════════════════════════════════════════════════
# 4. Edge cases no contexto TIPI
# ═══════════════════════════════════════════════════════════════════


class TestTipiEdgeCases:
    def test_multiple_units_in_one_position(self):
        html = TipiRenderer.render_position(
            _make_pos("Motor de 10 kW, 220 V, 50 Hz, peso 150 kg")
        )
        assert _has_highlight(html, "kW")
        assert _has_highlight(html, "V")
        assert _has_highlight(html, "Hz")
        assert _has_highlight(html, "kg")

    def test_unit_glued_to_number(self):
        html = TipiRenderer.render_position(_make_pos("Peso de 10kg"))
        assert _has_highlight(html, "kg")

    def test_decimal_with_comma(self):
        html = TipiRenderer.render_position(_make_pos("Potência de 37,5 W"))
        assert _has_highlight(html, "W")

    def test_exclusion_and_unit_highlights_coexist(self):
        """Tanto exclusões quanto unidades devem ser destacadas na mesma descrição."""
        html = TipiRenderer.render_position(
            _make_pos("Compressor de 10 kW, exceto os de uso doméstico")
        )
        assert "highlight-unit" in html
        assert "highlight-exclusion" in html
