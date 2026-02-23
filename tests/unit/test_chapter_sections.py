import pytest
from scripts.rebuild_index import extract_chapter_sections as extract_sections_rebuild
from scripts.setup_database import extract_chapter_sections as extract_sections_setup


@pytest.mark.parametrize(
    "extract_fn", [extract_sections_rebuild, extract_sections_setup]
)
def test_extract_chapter_sections_separates_blocks(extract_fn):
    content = "\n".join(
        [
            "Capítulo 73",
            "Obras de ferro fundido, ferro ou aço",
            "",
            "Notas.",
            "1.- Esta nota inicial.",
            "2.- Outra nota.",
            "",
            "CONSIDERAÇÕES GERAIS",
            "As disposições abaixo aplicam-se.",
            "",
            "1) Tubos:",
            "    Consideram-se, para fins deste capítulo, ...",
            "continua em linha minuscula.",
            "2) Perfis e chapas.",
            "Texto adicional de considerações gerais.",
            "",
            "73.01 - Produtos",
            "Conteúdo de posição.",
        ]
    )

    sections = extract_fn(content)

    assert sections["titulo"] == "Obras de ferro fundido, ferro ou aço"
    assert "Notas." not in sections["notas"]
    assert "CONSIDERAÇÕES GERAIS" not in sections["consideracoes"]
    assert "73.01" not in sections["notas"]
    assert "73.01" not in sections["consideracoes"]
    assert "73.01" not in sections["definicoes"]

    assert "1.- Esta nota inicial." in sections["notas"]
    assert "2.- Outra nota." in sections["notas"]

    assert "As disposições abaixo aplicam-se." in sections["consideracoes"]
    assert "Texto adicional de considerações gerais." in sections["consideracoes"]

    assert "1) Tubos:" in sections["definicoes"]
    assert "Consideram-se, para fins deste capítulo, ..." in sections["definicoes"]
    assert "continua em linha minuscula." in sections["definicoes"]
    assert "2) Perfis e chapas." in sections["definicoes"]
    assert "Texto adicional de considerações gerais." not in sections["definicoes"]
