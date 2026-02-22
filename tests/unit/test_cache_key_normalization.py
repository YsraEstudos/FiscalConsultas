"""Tests for search-route cache-key normalization."""

from starlette.requests import Request

from backend.presentation.routes.search import _accepts_gzip, _normalize_query_for_cache
from backend.utils.cache import weak_etag
from backend.utils.ncm_utils import is_code_query


def _normalize_query(ncm: str) -> str:
    return _normalize_query_for_cache(ncm, is_code_query=is_code_query(ncm))


def _build_request_with_accept_encoding(value: str) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/search",
        "headers": [(b"accept-encoding", value.encode("latin-1"))],
    }
    return Request(scope)


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


class TestAcceptsGzip:
    def test_accepts_plain_gzip(self):
        request = _build_request_with_accept_encoding("gzip")
        assert _accepts_gzip(request) is True

    def test_rejects_gzip_with_zero_quality(self):
        request = _build_request_with_accept_encoding("gzip;q=0")
        assert _accepts_gzip(request) is False

    def test_accepts_wildcard_with_positive_quality(self):
        request = _build_request_with_accept_encoding("*;q=1")
        assert _accepts_gzip(request) is True

    def test_rejects_gzip_and_wildcard_with_zero_quality(self):
        request = _build_request_with_accept_encoding("gzip;q=0,*;q=0")
        assert _accepts_gzip(request) is False
