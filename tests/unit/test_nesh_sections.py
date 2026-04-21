import pytest

from backend.utils.nesh_sections import _ChapterSectionParser, clean_markdown, extract_chapter_sections

pytestmark = pytest.mark.unit


def test_clean_markdown_removes_common_markup() -> None:
    assert clean_markdown("**Texto** *itálico* _sub_") == "Texto itálico sub"


def test_definition_continuation_detects_supported_patterns() -> None:
    assert _ChapterSectionParser._is_definition_continuation("continua", False, "") is True
    assert _ChapterSectionParser._is_definition_continuation("- item", False, "") is True
    assert _ChapterSectionParser._is_definition_continuation("Linha", False, "prefixo:") is True
    assert _ChapterSectionParser._is_definition_continuation("Linha", False, "") is False


def test_parser_header_and_definition_state_transitions() -> None:
    parser = _ChapterSectionParser()

    assert parser._consume_headers("Notas.") is True
    assert parser.current_section == "notas"
    assert parser.titulo_captured is True

    parser = _ChapterSectionParser()
    assert parser._consume_headers("CONSIDERAÇÕES GERAIS") is True
    assert parser.current_section == "consideracoes"

    parser = _ChapterSectionParser()
    assert parser._consume_definition_start("1) Item") is False
    parser.current_section = "consideracoes"
    assert parser._consume_definition_start("1) Item") is True
    assert parser.current_section == "definicoes"
    assert parser.section_lines["definicoes"] == ["1) Item"]


def test_parser_definition_body_handles_continuation_and_fallback() -> None:
    parser = _ChapterSectionParser()
    parser.current_section = "definicoes"
    parser.last_def_line = "1) Item:"
    assert parser._consume_definition_body("continua em linha", False) is True
    assert parser.section_lines["definicoes"] == ["continua em linha"]

    parser.current_section = "definicoes"
    parser.last_def_line = "1) Item"
    assert parser._consume_definition_body("2) Outro item", False) is True
    assert parser.section_lines["definicoes"][-1] == "2) Outro item"

    parser.current_section = "definicoes"
    parser.last_def_line = "1) Item"
    assert parser._consume_definition_body("Linha sem continuidade.", False) is False
    assert parser.current_section == "consideracoes"


def test_parser_only_captures_title_once() -> None:
    parser = _ChapterSectionParser()
    assert parser._consume_title("Título do capítulo") is True
    assert parser._consume_title("Outro título") is False
    assert parser.section_lines["titulo"] == ["Título do capítulo"]


def test_consume_line_and_build_cover_structured_sections() -> None:
    parser = _ChapterSectionParser()

    assert parser.consume_line("Capítulo 01") is False
    assert parser.consume_line("   ") is False
    assert parser.consume_line("Título do capítulo") is False
    assert parser.consume_line("Notas.") is False
    assert parser.consume_line("1.- Primeira nota.") is False
    assert parser.consume_line("CONSIDERAÇÕES GERAIS") is False
    assert parser.consume_line("1) Definição:") is False
    assert parser.consume_line("continua em linha") is False
    assert parser.consume_line("01.01 - posição") is True

    sections = parser.build()
    assert sections["titulo"] == "Título do capítulo"
    assert "1.- Primeira nota." in sections["notas"]
    assert "continua em linha" in sections["definicoes"]


def test_build_collapses_triple_newlines() -> None:
    parser = _ChapterSectionParser()
    parser.section_lines["titulo"] = ["Linha 1", "", "", "Linha 2"]

    assert parser.build()["titulo"] == "Linha 1\n\nLinha 2"


def test_extract_chapter_sections_returns_structured_blocks() -> None:
    content = "\n".join(
        [
            "Capítulo 10",
            "Nome do capítulo",
            "",
            "Notas.",
            "1.- Nota oficial.",
            "",
            "CONSIDERAÇÕES GERAIS",
            "Texto introdutório.",
            "",
            "1) Definição:",
            "continuação da definição",
            "",
            "10.01 - posição de corte",
        ]
    )

    sections = extract_chapter_sections(content)

    assert sections["titulo"] == "Nome do capítulo"
    assert "Nota oficial." in sections["notas"]
    assert "Texto introdutório." in sections["consideracoes"]
    assert "continuação da definição" in sections["definicoes"]
