from pathlib import Path

import pytest

from backend.utils.nbs_parser import (
    build_nbs_code_variants,
    build_nbs_items,
    build_sort_path,
    clean_nbs_code,
    iter_nbs_rows,
    normalize_nbs_text,
)

pytestmark = pytest.mark.unit


def test_normalize_nbs_text_removes_accents_and_spaces():
    assert (
        normalize_nbs_text("  Serviços   de Construção  ") == "servicos de construcao"
    )


def test_build_sort_path_zero_pads_segments():
    assert build_sort_path("1.0101.11.00") == "00000001.00000101.00000011.00000000"


def test_iter_nbs_rows_skips_header_and_reads_semicolon_data(tmp_path: Path):
    csv_path = tmp_path / "nbs.csv"
    csv_path.write_text(
        "NBS 2.0;DESCRIÇÃO\n1.01;Serviços de construção\n1.0101;Serviços de edificações\n",
        encoding="utf-8-sig",
    )

    assert list(iter_nbs_rows(csv_path)) == [
        ("1.01", "Serviços de construção"),
        ("1.0101", "Serviços de edificações"),
    ]


def test_iter_nbs_rows_skips_empty_and_partial_rows(tmp_path: Path):
    csv_path = tmp_path / "nbs_partial.csv"
    csv_path.write_text(
        "NBS 2.0;DESCRIÇÃO\n\n1.01;\n;Sem código\n1.02;Descrição válida\n",
        encoding="utf-8-sig",
    )

    assert list(iter_nbs_rows(csv_path)) == [("1.02", "Descrição válida")]


def test_build_nbs_items_creates_hierarchy_from_prefix_chain():
    items = build_nbs_items(
        [
            ("1.01", "Serviços de construção"),
            ("1.0101", "Serviços de construção de edificações"),
            ("1.0101.1", "Serviços residenciais"),
            ("1.0101.11.00", "Serviços de um e dois pavimentos"),
        ]
    )

    assert [item.parent_code for item in items] == [None, "1.01", "1.0101", "1.0101.1"]
    assert [item.level for item in items] == [0, 1, 2, 3]


def test_build_nbs_items_rejects_duplicate_codes():
    with pytest.raises(ValueError, match="duplicado"):
        build_nbs_items([("1.01", "A"), ("1.01", "B")])


def test_clean_nbs_code_keeps_only_digits():
    assert clean_nbs_code("1.0101.11.00") == "101011100"


def test_build_nbs_code_variants_returns_empty_literal_for_blank_code():
    assert build_nbs_code_variants("") == ()


def test_build_nbs_code_variants_adds_alias_without_trailing_zero_suffix():
    assert build_nbs_code_variants("1.0101.11.00") == ("1.0101.11.00", "1.0101.11")


def test_build_nbs_code_variants_adds_canonical_leaf_suffix():
    assert build_nbs_code_variants("1.0101.11") == ("1.0101.11", "1.0101.11.00")


def test_repository_nbs_source_matches_corrected_pdf_rows():
    source_path = Path(__file__).resolve().parents[2] / "data" / "nbs.csv"

    rows = dict(iter_nbs_rows(source_path))

    assert "1.0402.11.11" in rows
    assert "1.0402.11.19" in rows
    assert "1.0402.11.10" not in rows
    assert "1.0402.11.90" not in rows
    assert (
        rows["1.0501.24.22"]
        == "Serviços de transporte rodoviário de produtos químicos perigosos, exceto lubrificantes e GLP"
    )
    assert rows["1.0505.10.00"] == "Locação de veículos rodoviários de carga com motorista"
    assert (
        rows["1.1404.49.00"]
        == "Serviços de análise e exames técnicos não classificados em subposições anteriores"
    )
    assert (
        rows["1.1706.2"]
        == "Serviços de transmissão de sinais, sons e imagens de rádio e televisão, aberta ou por assinatura; e serviços de distribuição de pacotes de televisão por assinatura"
    )
    assert (
        rows["1.2001.82.00"]
        == "Serviços de manutenção e reparação de instrumentos e equipamentos médico- hospitalares, odontológicos, óticos e de precisão"
    )
    assert (
        rows["1.2003.24.00"]
        == "Serviços de instalação de maquinários, equipamentos, instrumentos e aparelhos médico- hospitalares, óticos e de precisão"
    )
