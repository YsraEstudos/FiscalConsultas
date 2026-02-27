import pytest

from backend.presentation.renderer import HtmlRenderer


@pytest.mark.unit
def test_clean_content_converts_bracket_superscripts_and_plus_artifact() -> None:
    content = "Massa [ 3 ] por m [2] e marcador (+) aplicado"

    cleaned = HtmlRenderer.clean_content(content)

    assert "³" in cleaned
    assert "²" in cleaned
    assert "nesh-subpos-indicator" in cleaned


@pytest.mark.unit
def test_normalize_lines_skips_single_char_bullet_artifact() -> None:
    content = "• o\n• Item válido\no Outro item válido"

    normalized = HtmlRenderer._normalize_lines(content)

    assert "- o" not in normalized
    assert "- Item válido" in normalized
    assert "- Outro item válido" in normalized
