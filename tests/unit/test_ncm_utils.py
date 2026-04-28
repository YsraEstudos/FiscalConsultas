import pytest

from backend.utils.ncm_utils import (
    clean_ncm,
    extract_chapter_from_ncm,
    format_ncm_tipi,
    is_code_query,
    split_ncm_query,
)


def test_clean_ncm_removes_non_digits() -> None:
    assert clean_ncm("85.17-10") == "851710"


def test_extract_chapter_from_ncm_handles_blank_and_short_inputs() -> None:
    assert extract_chapter_from_ncm("") == (None, None)
    assert extract_chapter_from_ncm("8") == ("08", None)
    assert extract_chapter_from_ncm("84") == ("84", None)


def test_extract_chapter_from_ncm_preserves_explicit_short_subpositions() -> None:
    assert extract_chapter_from_ncm("8419.8") == ("84", "8419.8")
    assert extract_chapter_from_ncm("8419.80") == ("84", "8419.80")


def test_extract_chapter_from_ncm_builds_dotted_target_for_compact_codes() -> None:
    assert extract_chapter_from_ncm("8471.30.19") == ("84", "84.71")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("84139190", "8413.91.90"),
        ("8413110", "8413.11.0"),
        ("841311", "8413.11"),
        ("84131", "8413.1"),
        ("8413", "84.13"),
        ("84", "84"),
        ("", ""),
    ],
)
def test_format_ncm_tipi_handles_known_lengths(raw: str, expected: str) -> None:
    assert format_ncm_tipi(raw) == expected


def test_format_ncm_tipi_returns_original_text_when_no_digits() -> None:
    assert format_ncm_tipi("abc") == "abc"


def test_format_ncm_tipi_falls_back_for_unexpected_lengths() -> None:
    assert format_ncm_tipi("123456789") == "123456789"


def test_is_code_query_detects_only_numeric_like_queries() -> None:
    assert is_code_query("85.17-10") is True
    assert is_code_query("motor eletrico") is False
    assert is_code_query("") is False


def test_split_ncm_query_accepts_spaces_as_separator() -> None:
    assert split_ncm_query("4903.90.00 8417") == ["4903.90.00", "8417"]


def test_split_ncm_query_accepts_mixed_separators() -> None:
    assert split_ncm_query("4903.90.00, 8417; 8501") == ["4903.90.00", "8417", "8501"]


def test_split_ncm_query_discards_blank_segments() -> None:
    assert split_ncm_query("   ") == []
