"""Tests for search-route cache-key normalization."""

from backend.presentation.routes.search import _normalize_query_for_cache
from backend.utils.cache import weak_etag
from backend.utils.ncm_utils import is_code_query


def _normalize_query(ncm: str) -> str:
    return _normalize_query_for_cache(ncm, is_code_query=is_code_query(ncm))


class TestCodeQueryNormalization:
    def test_dotted_and_plain_same_key(self):
        assert _normalize_query("85.17") == _normalize_query("8517") == "8517"

    def test_whitespace_around_single_code_is_ignored(self):
        assert _normalize_query(" 8517 ") == _normalize_query("8517")

    def test_dashes_removed_inside_single_code(self):
        assert _normalize_query("85.17-10") == _normalize_query("851710") == "851710"

    def test_equivalent_multi_code_separators_share_same_key(self):
        variants = ["85,17", "85 17"]
        normalized = {_normalize_query(variant) for variant in variants}
        assert normalized == {"85,17"}

    def test_multi_code_query_does_not_alias_single_code(self):
        assert _normalize_query("85,17") != _normalize_query("8517")

    def test_etag_differs_for_multi_code_and_single_code(self):
        scope = "public"
        etag_multi = weak_etag("nesh", scope, _normalize_query("85,17"))
        etag_single = weak_etag("nesh", scope, _normalize_query("8517"))
        assert etag_multi != etag_single


class TestTextQueryNormalization:
    def test_case_insensitive(self):
        assert _normalize_query("Capacitor") == _normalize_query("capacitor")

    def test_whitespace_stripped(self):
        assert _normalize_query("  capacitor  ") == _normalize_query("capacitor")

    def test_mixed_case_and_spaces(self):
        assert _normalize_query("  Sem Fio  ") == _normalize_query("sem fio")

    def test_different_terms_different_key(self):
        assert _normalize_query("capacitor") != _normalize_query("resistor")
