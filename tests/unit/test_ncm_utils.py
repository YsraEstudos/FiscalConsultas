from backend.utils.ncm_utils import split_ncm_query


def test_split_ncm_query_accepts_spaces_as_separator() -> None:
    assert split_ncm_query("4903.90.00 8417") == ["4903.90.00", "8417"]


def test_split_ncm_query_accepts_mixed_separators() -> None:
    assert split_ncm_query("4903.90.00, 8417; 8501") == ["4903.90.00", "8417", "8501"]
