import re

import backend.data.glossary_manager as glossary_module
import pytest
from backend.presentation import renderer
from backend.presentation.renderer import HtmlRenderer, _MultiTransformParser

pytestmark = pytest.mark.unit


class _FakeGlossaryManager:
    def __init__(self, pattern):
        self._pattern = pattern

    def get_regex_pattern(self):
        return self._pattern


def test_multi_transform_parser_applies_transforms_and_skips_marked_regions():
    parser = _MultiTransformParser(
        [(re.compile(r"foo"), lambda _match: "bar")],
        text_post_processor=lambda text: text.replace("bar", "BAR"),
        skip_inside_tags={"code"},
    )
    html = '<p>foo &amp; &#169;</p><a class="smart-link"><span>foo</span></a><code>foo</code><br/>foo'

    parser.feed(html)
    parser.close()
    out = parser.get_html()

    assert "<p>BAR &amp; &#169;</p>" in out
    assert '<a class="smart-link"><span>foo</span></a>' in out
    assert "<code>foo</code>" in out
    assert "<br/>BAR" in out


def test_convert_text_to_html_returns_empty_for_empty_input():
    assert HtmlRenderer._convert_text_to_html("") == ""


def test_convert_text_to_html_builds_heading_lists_and_paragraph_blocks():
    text = (
        "85.17 - Telefones\r\n\r\n"
        "1. Primeiro item\n2. Segundo item\r\n\r\n"
        "I. Item romano\nII. Outro romano\r\n\r\n"
        "a) Alfa\nb) Beta\r\n\r\n"
        "a) Item A\nb) Item B\ntexto livre"
    )

    out = HtmlRenderer._convert_text_to_html(text)

    assert '<h3 class="nesh-heading" data-ncm="8517">' in out
    assert (
        '<ol class="nesh-list"><li>Primeiro item</li><li>Segundo item</li></ol>' in out
    )
    assert (
        '<ol type="I" class="nesh-list"><li>Item romano</li><li>Outro romano</li></ol>'
        in out
    )
    assert '<ol type="a" class="nesh-list"><li>Alfa</li><li>Beta</li></ol>' in out
    assert '<ol type="a" class="nesh-list"><li>Item A</li><li>Item B</li></ol>' in out
    assert '<p class="nesh-paragraph">texto livre</p>' in out


def test_inject_smart_links_handles_plain_text_and_html_skip_zones():
    plain = HtmlRenderer.inject_smart_links("Veja 85.17 e 8419.8", "85")
    assert plain.count('class="smart-link"') == 2

    html = (
        'fora 85.17 <a href="#">dentro 84.13</a> <span class="smart-link">8419.8</span>'
    )
    out = HtmlRenderer.inject_smart_links(html, "85")

    assert 'data-ncm="8517"' in out
    assert '<a href="#">dentro 84.13</a>' in out
    assert '<span class="smart-link">8419.8</span>' in out


def test_inject_smart_links_falls_back_when_parser_raises(monkeypatch):
    def _boom(self, _data):  # pragma: no cover - explicit fallback trigger
        raise RuntimeError("parser failure")

    monkeypatch.setattr(renderer.HTMLParser, "feed", _boom)
    out = HtmlRenderer.inject_smart_links("<p>85.17</p>", "85")
    assert 'class="smart-link"' in out


def test_inject_unit_highlights_handles_leading_whitespace_in_match(monkeypatch):
    monkeypatch.setattr(HtmlRenderer, "RE_UNIT", re.compile(r"\s+kg"))
    out = HtmlRenderer.inject_unit_highlights("10  kg")
    assert '10  <span class="highlight-unit">kg</span>' in out


def test_inject_unit_highlights_falls_back_when_parser_raises(monkeypatch):
    def _boom(self, _data):  # pragma: no cover - explicit fallback trigger
        raise RuntimeError("parser failure")

    monkeypatch.setattr(renderer.HTMLParser, "feed", _boom)
    out = HtmlRenderer.inject_unit_highlights("<p>10 kW</p>")
    assert "highlight-unit" in out


def test_inject_glossary_highlights_returns_original_when_regex_unavailable(
    monkeypatch,
):
    monkeypatch.setattr(glossary_module, "glossary_manager", _FakeGlossaryManager(None))
    text = "texto sem termo técnico"
    assert HtmlRenderer.inject_glossary_highlights(text) == text


def test_inject_glossary_highlights_wraps_terms_when_regex_exists(monkeypatch):
    monkeypatch.setattr(
        glossary_module,
        "glossary_manager",
        _FakeGlossaryManager(re.compile(r"\bRotor\b")),
    )
    out = HtmlRenderer.inject_glossary_highlights("Rotor técnico")
    assert '<span class="glossary-term" data-term="Rotor">Rotor</span>' in out


def test_convert_bold_markdown_supports_plain_and_html_text():
    assert (
        HtmlRenderer.convert_bold_markdown("**negrito**") == "<strong>negrito</strong>"
    )

    out = HtmlRenderer.convert_bold_markdown("<p>**a** <span>**b**</span></p>")
    assert "<strong>a</strong>" in out
    assert "<span><strong>b</strong></span>" in out


def test_convert_bold_markdown_falls_back_when_parser_raises(monkeypatch):
    def _boom(self, _data):  # pragma: no cover - explicit fallback trigger
        raise RuntimeError("parser failure")

    monkeypatch.setattr(renderer.HTMLParser, "feed", _boom)
    out = HtmlRenderer.convert_bold_markdown("<p>**texto**</p>")
    assert "<strong>texto</strong>" in out


def test_apply_post_transforms_plain_text_applies_all_layers(monkeypatch):
    monkeypatch.setattr(
        renderer, "glossary_manager", _FakeGlossaryManager(re.compile(r"\bRotor\b"))
    )
    out = HtmlRenderer.apply_post_transforms(
        "**Importante** exceto 10 W e 85.17 Rotor", "85"
    )

    assert "<strong>Importante</strong>" in out
    assert '<span class="highlight-exclusion">exceto</span>' in out
    assert 'class="highlight-unit">W<' in out
    assert 'class="smart-link" data-ncm="8517"' in out
    assert 'class="glossary-term" data-term="Rotor"' in out


def test_apply_post_transforms_html_skips_existing_links(monkeypatch):
    monkeypatch.setattr(renderer, "glossary_manager", _FakeGlossaryManager(None))
    html = '<p>fora 85.17 e 10 W <a href="#">dentro 84.13 e 20 W</a></p>'

    out = HtmlRenderer.apply_post_transforms(html, "85")

    assert 'class="smart-link" data-ncm="8517"' in out
    assert 'class="smart-link" data-ncm="8413"' not in out
    assert out.count('class="highlight-unit"') == 1
    assert "dentro 84.13 e 20 W" in out


def test_apply_post_transforms_falls_back_when_parser_raises(monkeypatch):
    monkeypatch.setattr(renderer, "glossary_manager", _FakeGlossaryManager(None))

    def _boom(self, _data):  # pragma: no cover - explicit fallback trigger
        raise RuntimeError("parser failure")

    monkeypatch.setattr(renderer.HTMLParser, "feed", _boom)
    out = HtmlRenderer.apply_post_transforms("<p>**x** 85.17</p>", "85")
    assert "<strong>x</strong>" in out
    assert 'class="smart-link"' in out


def test_render_chapter_returns_error_block_when_content_missing():
    out = HtmlRenderer.render_chapter({"capitulo": "99", "real_content_found": False})
    assert "Capítulo 99" in out
    assert "Capítulo não encontrado" in out


def test_render_chapter_structures_sections_normalizes_lines_and_trims_other_chapter():
    data = {
        "capitulo": "85",
        "conteudo": (
            "85.17 - Heading principal\n"
            "8419.8 - Subposição curta\n"
            "85.18: Linha sem heading padrão\n"
            "85.18: Linha repetida\n"
            "•\n"
            "• Item de lista\n"
            "**Título Solto**\n"
            "**Resumo** detalhes finais\n"
            "ver Nota 3 do Capítulo 84\n\n"
            "CAPÍTULO 49\n"
            "Trecho que deve ser removido"
        ),
        "notas_gerais": "Linha 1\n\nLinha 2",
        "posicoes": [
            "invalid",
            {"codigo": "8518"},
            {"codigo": "85.17"},
            {"codigo": "85.18"},
        ],
        "real_content_found": True,
    }

    out = HtmlRenderer.render_chapter(data)

    assert 'id="pos-85-17"' in out
    assert 'id="pos-8419-8"' in out
    assert out.count('id="pos-85-18"') == 1
    assert 'class="nesh-subheading">Título Solto<' in out
    assert 'class="nesh-inline-title">Resumo<' in out
    assert 'data-note="3"' in out
    assert 'data-chapter="84"' in out
    assert '<div class="regras-gerais" id="chapter-85-notas">' in out
    assert "<p><br></p>" in out
    assert "Trecho que deve ser removido" not in out
    assert "•" not in out


def test_render_chapter_trims_at_section_header():
    data = {
        "capitulo": "85",
        "conteudo": "Introdução útil\nSEÇÃO XI\nTexto que não deve aparecer",
        "notas_gerais": None,
        "posicoes": [],
        "real_content_found": True,
    }

    out = HtmlRenderer.render_chapter(data)

    assert "Introdução útil" in out
    assert "SEÇÃO XI" not in out
    assert "Texto que não deve aparecer" not in out


def test_render_chapter_renders_structured_sections_with_navigation_ids():
    data = {
        "capitulo": "84",
        "conteudo": "84.13 - Bombas para liquidos",
        "notas_gerais": "Nao deve aparecer quando secoes existem",
        "secoes": {
            "titulo": "Reatores nucleares",
            "notas": "1.- Nota principal",
            "consideracoes": "Consideracoes gerais da secao",
            "definicoes": "1) Definicao tecnica",
        },
        "posicoes": [{"codigo": "84.13"}],
        "real_content_found": True,
    }

    out = HtmlRenderer.render_chapter(data)

    assert 'id="chapter-84-titulo"' in out
    assert 'id="chapter-84-notas"' in out
    assert 'id="chapter-84-consideracoes"' in out
    assert 'id="chapter-84-definicoes"' in out
    assert '<div class="regras-gerais"' not in out


def test_render_full_response_continues_when_one_chapter_raises(monkeypatch):
    def _fake_render_chapter(cls, data):
        if data.get("capitulo") == "02":
            raise RuntimeError("boom")
        return f"<h2>{data['capitulo']}</h2>"

    monkeypatch.setattr(
        HtmlRenderer, "render_chapter", classmethod(_fake_render_chapter)
    )

    out = HtmlRenderer.render_full_response(
        {
            "02": {"capitulo": "02"},
            "01": {"capitulo": "01"},
        }
    )

    assert "<h2>01</h2>" in out
    assert "Falha ao renderizar Capítulo 02" in out
