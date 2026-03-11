from pathlib import Path

import pytest

from backend.utils.nbs_parser import (
    build_nbs_items,
    build_sort_path,
    iter_nbs_rows,
    normalize_nbs_text,
)

pytestmark = pytest.mark.unit


def test_normalize_nbs_text_removes_accents_and_spaces():
    assert normalize_nbs_text("  Serviços   de Construção  ") == "servicos de construcao"


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
