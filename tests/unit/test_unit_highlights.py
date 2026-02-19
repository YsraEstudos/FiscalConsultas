"""
Testes abrangentes para o sistema de destaque de unidades de medida.
Validam a regex MEASUREMENT_UNITS e o método inject_unit_highlights.
"""
import re
import pytest

from backend.presentation.renderer import HtmlRenderer


# ═══════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════

def _has_highlight(html: str, unit: str) -> bool:
    """Verifica se a unidade está envolvida em <span class="highlight-unit">."""
    return f'class="highlight-unit">{unit}</span>' in html


def _no_highlight(html: str, word: str) -> bool:
    """Verifica que a palavra NÃO foi destacada."""
    return f'class="highlight-unit">{word}</span>' not in html


# ═══════════════════════════════════════════════════════════════════
# 1. Unidades multi-letra tradicionais
# ═══════════════════════════════════════════════════════════════════

class TestMultiLetterUnits:
    """Unidades de 2+ letras que não exigem dígito antes."""

    @pytest.mark.parametrize("unit", [
        "kWh", "MWh", "Wh",
        "kVA", "VA",
        "kW", "MW",
        "mV", "kV",
        "mA", "kA",
        "Ah", "mAh",
        "Hz", "kHz", "MHz", "GHz",
        "rpm",
        "mbar", "MPa", "kPa", "Pa", "psi",
        "kg", "mg",
        "km", "cm", "mm",
        "ml",
        "ha",
        "dB",
        "lux", "lm",
        "Btu",
        "kN", "daN",
        "MJ", "kJ",
        "pol",
    ])
    def test_multi_letter_unit_highlighted(self, unit: str):
        text = f"Valor de 100 {unit} no teste"
        out = HtmlRenderer.inject_unit_highlights(text)
        assert _has_highlight(out, unit), f"Unidade '{unit}' deveria ser destacada em: {out}"

    @pytest.mark.parametrize("unit", ["µm", "nm", "µF", "pF", "nF", "mF", "µH", "mH"])
    def test_unicode_prefix_units(self, unit: str):
        text = f"Componente de 100 {unit}"
        out = HtmlRenderer.inject_unit_highlights(text)
        assert _has_highlight(out, unit), f"Unidade '{unit}' deveria ser destacada em: {out}"

    @pytest.mark.parametrize("unit", ["Ω", "kΩ", "MΩ", "ohm"])
    def test_resistance_units(self, unit: str):
        text = f"Resistor de 10 {unit}"
        out = HtmlRenderer.inject_unit_highlights(text)
        assert _has_highlight(out, unit), f"Unidade '{unit}' deveria ser destacada em: {out}"

    def test_temperature_units(self):
        for unit in ["°C", "ºC", "°F", "Kelvin"]:
            text = f"Temperatura de 25 {unit}"
            out = HtmlRenderer.inject_unit_highlights(text)
            assert _has_highlight(out, unit), f"'{unit}' deveria ser destacada"

    def test_volume_and_area_units(self):
        for unit in ["m³", "m3", "m²", "m2", "cm³", "cm3", "cm²", "cm2",
                      "mm³", "mm3", "mm²", "mm2", "m³/h", "m3/h"]:
            text = f"Capacidade de 50 {unit}"
            out = HtmlRenderer.inject_unit_highlights(text)
            assert _has_highlight(out, unit), f"'{unit}' deveria ser destacada"

    def test_tonelada_singular_and_plural(self):
        out1 = HtmlRenderer.inject_unit_highlights("5 toneladas")
        out2 = HtmlRenderer.inject_unit_highlights("1 tonelada")
        assert _has_highlight(out1, "toneladas")
        assert _has_highlight(out2, "tonelada")

    def test_litros_singular_and_plural(self):
        out1 = HtmlRenderer.inject_unit_highlights("20 litros")
        out2 = HtmlRenderer.inject_unit_highlights("1 litro")
        assert re.search(r'highlight-unit">litros?</span>', out1)
        assert re.search(r'highlight-unit">litros?</span>', out2)

    def test_polegadas_singular_and_plural(self):
        out1 = HtmlRenderer.inject_unit_highlights("Tubo de 2 polegadas")
        out2 = HtmlRenderer.inject_unit_highlights("Tubo de 1 polegada")
        assert _has_highlight(out1, "polegadas")
        assert _has_highlight(out2, "polegada")


# ═══════════════════════════════════════════════════════════════════
# 2. Unidades de 1 letra (exigem dígito antes)
# ═══════════════════════════════════════════════════════════════════

class TestSingleLetterUnits:
    """Unidades de 1 letra que só casam após um dígito."""

    @pytest.mark.parametrize("unit", ["W", "V", "A", "K", "m", "l", "t", "g", "N", "J"])
    def test_single_letter_after_digit(self, unit: str):
        text = f"Valor de 100 {unit} no componente"
        out = HtmlRenderer.inject_unit_highlights(text)
        assert _has_highlight(out, unit), f"'{unit}' após dígito deveria ser destacada em: {out}"

    @pytest.mark.parametrize("unit", ["W", "V", "A", "K", "m", "l", "t", "g", "N", "J"])
    def test_single_letter_without_digit_not_highlighted(self, unit: str):
        text = f"Texto {unit} sem contexto numérico"
        out = HtmlRenderer.inject_unit_highlights(text)
        assert _no_highlight(out, unit), f"'{unit}' SEM dígito antes NÃO deveria ser destacada em: {out}"

    def test_bar_after_digit_highlighted(self):
        out = HtmlRenderer.inject_unit_highlights("Pressão de 100 bar")
        assert _has_highlight(out, "bar")

    def test_bar_without_digit_not_highlighted(self):
        out = HtmlRenderer.inject_unit_highlights("entrou no bar à noite")
        assert _no_highlight(out, "bar")

    def test_bar_in_mbar_still_works(self):
        """mbar é multi-letra e não precisa de dígito antes."""
        out = HtmlRenderer.inject_unit_highlights("Pressão de 100 mbar")
        assert _has_highlight(out, "mbar")


# ═══════════════════════════════════════════════════════════════════
# 3. Falsos positivos — NÃO devem ser destacados
# ═══════════════════════════════════════════════════════════════════

class TestFalsePositives:
    """Garantir que palavras comuns não sejam falsamente destacadas."""

    def test_portuguese_article_um_not_highlighted(self):
        out = HtmlRenderer.inject_unit_highlights("um núcleo de aço")
        assert _no_highlight(out, "um")

    def test_preposition_a_not_highlighted(self):
        # "a" é preposição, não Ampere — sem dígito antes
        out = HtmlRenderer.inject_unit_highlights("a mesa grande")
        assert _no_highlight(out, "a")

    def test_m_inside_word_not_highlighted(self):
        out = HtmlRenderer.inject_unit_highlights("caixa de material resistente")
        assert "highlight-unit" not in out

    def test_pa_inside_word_not_highlighted(self):
        out = HtmlRenderer.inject_unit_highlights("Para cada item separado")
        # "Pa" dentro de "Para" não pode casar
        assert _no_highlight(out, "Pa")

    def test_kg_inside_word_not_highlighted(self):
        out = HtmlRenderer.inject_unit_highlights("background e packaging")
        assert "highlight-unit" not in out

    def test_ha_inside_word_not_highlighted(self):
        out = HtmlRenderer.inject_unit_highlights("existem melhores chances")
        assert "highlight-unit" not in out

    def test_va_as_verb_not_highlighted(self):
        """'va' ou 'VA' como verbo — com lookbehind/lookahead deveria ser safe em contexto de palavras."""
        # Em texto com letras ao redor, não deve casar
        out = HtmlRenderer.inject_unit_highlights("não vá embora")
        assert _no_highlight(out, "vá")

    def test_n_in_word_not_highlighted(self):
        """N dentro de 'Não' não deve ser destacado."""
        out = HtmlRenderer.inject_unit_highlights("Não compreende os seguintes")
        assert _no_highlight(out, "N")

    def test_j_in_word_not_highlighted(self):
        out = HtmlRenderer.inject_unit_highlights("José comprou peças")
        assert _no_highlight(out, "J")

    def test_text_without_any_units(self):
        out = HtmlRenderer.inject_unit_highlights("Cavalos vivos para reprodução")
        assert "highlight-unit" not in out

    def test_empty_string(self):
        out = HtmlRenderer.inject_unit_highlights("")
        assert out == ""


# ═══════════════════════════════════════════════════════════════════
# 4. Edge cases — formatação e pontuação
# ═══════════════════════════════════════════════════════════════════

class TestEdgeCases:
    """Cenários de borda: espaço, pontuação, parênteses, etc."""

    def test_unit_glued_to_number(self):
        """10kg (sem espaço) — kg deve ser destacado."""
        out = HtmlRenderer.inject_unit_highlights("Peso de 10kg bruto")
        assert _has_highlight(out, "kg")

    def test_unit_after_number_with_space(self):
        out = HtmlRenderer.inject_unit_highlights("Peso de 10 kg bruto")
        assert _has_highlight(out, "kg")

    def test_unit_followed_by_period(self):
        out = HtmlRenderer.inject_unit_highlights("Potência de 10 kW.")
        assert _has_highlight(out, "kW")

    def test_unit_followed_by_comma(self):
        out = HtmlRenderer.inject_unit_highlights("10 kW, 20 V e 5 A")
        assert _has_highlight(out, "kW")
        assert _has_highlight(out, "V")
        assert _has_highlight(out, "A")

    def test_unit_in_parentheses(self):
        out = HtmlRenderer.inject_unit_highlights("Capacidade (10 kW)")
        assert _has_highlight(out, "kW")

    def test_decimal_with_comma(self):
        """37,5 W — decimal brasileiro com vírgula."""
        out = HtmlRenderer.inject_unit_highlights("37,5 W de potência")
        assert _has_highlight(out, "W")

    def test_thousand_separator_with_period(self):
        """10.000 kVA — milhar com ponto."""
        out = HtmlRenderer.inject_unit_highlights("Transformador de 10.000 kVA")
        assert _has_highlight(out, "kVA")

    def test_single_letter_with_multiple_spaces(self):
        """Até 3 espaços entre número e unidade de 1 letra."""
        out = HtmlRenderer.inject_unit_highlights("10   m de comprimento")
        assert _has_highlight(out, "m")

    def test_single_letter_with_4_spaces_not_matched(self):
        """4+ espaços: a unidade de 1 letra NÃO casa."""
        out = HtmlRenderer.inject_unit_highlights("10    m de comprimento")
        assert _no_highlight(out, "m")

    def test_multiple_units_in_one_text(self):
        text = "Motor de 10 kW, 220 V, 50 Hz com peso de 150 kg"
        out = HtmlRenderer.inject_unit_highlights(text)
        assert _has_highlight(out, "kW")
        assert _has_highlight(out, "V")
        assert _has_highlight(out, "Hz")
        assert _has_highlight(out, "kg")

    def test_case_insensitive_matching(self):
        """(?i) faz kw, KW, Kw casarem."""
        for variant in ["kw", "KW", "Kw"]:
            out = HtmlRenderer.inject_unit_highlights(f"10 {variant}")
            assert "highlight-unit" in out, f"'{variant}' deveria ser destacada"


# ═══════════════════════════════════════════════════════════════════
# 5. HTML-aware — smart-links e tags
# ═══════════════════════════════════════════════════════════════════

class TestHtmlAwareness:
    """Garantir que unidades dentro de smart-links não sejam destacadas."""

    def test_ignores_units_inside_smart_links(self):
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

    def test_units_outside_tags_highlighted(self):
        html = '<p>Motor de 10 kW</p>'
        out = HtmlRenderer.inject_unit_highlights(html)
        assert _has_highlight(out, "kW")

    def test_plain_text_fast_path(self):
        """Texto sem < ou > usa o caminho direto (sem parser HTML)."""
        text = "Capacidade de 500 litros"
        out = HtmlRenderer.inject_unit_highlights(text)
        assert re.search(r'highlight-unit">litros?</span>', out)

    def test_malformed_html_fallback(self):
        """HTML malformado: fallback aplica regex diretamente."""
        bad_html = "<p>Motor de 10 kW<br"
        out = HtmlRenderer.inject_unit_highlights(bad_html)
        assert _has_highlight(out, "kW")


# ═══════════════════════════════════════════════════════════════════
# 6. Novas unidades adicionadas
# ═══════════════════════════════════════════════════════════════════

class TestNewUnits:
    """Validar as novas unidades expandidas na regex."""

    def test_db_decibel(self):
        out = HtmlRenderer.inject_unit_highlights("Ruído de 85 dB")
        assert _has_highlight(out, "dB")

    def test_ohm_variants(self):
        for unit in ["Ω", "kΩ", "MΩ", "ohm"]:
            out = HtmlRenderer.inject_unit_highlights(f"Resistor de 10 {unit}")
            assert _has_highlight(out, unit), f"'{unit}' deveria ser destacada"

    def test_capacitance_units(self):
        for unit in ["µF", "pF", "nF", "mF"]:
            out = HtmlRenderer.inject_unit_highlights(f"Capacitor de 100 {unit}")
            assert _has_highlight(out, unit), f"'{unit}' deveria ser destacada"

    def test_inductance_units(self):
        for unit in ["µH", "mH"]:
            out = HtmlRenderer.inject_unit_highlights(f"Indutor de 10 {unit}")
            assert _has_highlight(out, unit), f"'{unit}' deveria ser destacada"

    def test_force_units(self):
        out = HtmlRenderer.inject_unit_highlights("Força de 50 N aplicada")
        assert _has_highlight(out, "N")
        out2 = HtmlRenderer.inject_unit_highlights("Resistência de 100 kN")
        assert _has_highlight(out2, "kN")
        out3 = HtmlRenderer.inject_unit_highlights("Força de 10 daN")
        assert _has_highlight(out3, "daN")

    def test_energy_joule(self):
        out = HtmlRenderer.inject_unit_highlights("Energia de 500 J")
        assert _has_highlight(out, "J")
        out2 = HtmlRenderer.inject_unit_highlights("Energia de 10 kJ")
        assert _has_highlight(out2, "kJ")
        out3 = HtmlRenderer.inject_unit_highlights("Energia de 5 MJ")
        assert _has_highlight(out3, "MJ")

    def test_illumination_units(self):
        out = HtmlRenderer.inject_unit_highlights("Luminosidade de 800 lm")
        assert _has_highlight(out, "lm")
        out2 = HtmlRenderer.inject_unit_highlights("Iluminação de 500 lux")
        assert _has_highlight(out2, "lux")

    def test_btu(self):
        out = HtmlRenderer.inject_unit_highlights("Ar-condicionado de 12000 Btu")
        assert _has_highlight(out, "Btu")

    def test_psi(self):
        out = HtmlRenderer.inject_unit_highlights("Pressão de 30 psi")
        assert _has_highlight(out, "psi")

    def test_polegadas(self):
        out = HtmlRenderer.inject_unit_highlights("Tubo de 2 polegadas de diâmetro")
        assert _has_highlight(out, "polegadas")

    def test_pol_abbreviation(self):
        out = HtmlRenderer.inject_unit_highlights("Diâmetro de 3 pol")
        assert _has_highlight(out, "pol")
