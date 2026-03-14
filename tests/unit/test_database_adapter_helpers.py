import pytest

from backend.infrastructure.database import DatabaseAdapter


@pytest.mark.unit
def test_sanitize_fts_token_quotes_normal_token() -> None:
    assert DatabaseAdapter._sanitize_fts_token("motor") == '"motor"'


@pytest.mark.unit
def test_sanitize_fts_token_filters_reserved_operator() -> None:
    assert DatabaseAdapter._sanitize_fts_token("OR") == ""


@pytest.mark.unit
def test_sanitize_fts_token_removes_special_chars() -> None:
    assert DatabaseAdapter._sanitize_fts_token('"motor")*') == '"motor"'


@pytest.mark.unit
def test_sanitize_fts_token_keeps_first_word_only() -> None:
    assert DatabaseAdapter._sanitize_fts_token("bomba hidraulica") == '"bomba"'
