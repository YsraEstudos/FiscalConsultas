"""Tests for TIPI-route cache-key normalization and request validation."""

import pytest
from starlette.requests import Request

from backend.config.constants import SearchConfig, ViewMode
from backend.config.exceptions import ValidationError
from backend.presentation.routes.tipi import (
    _build_tipi_payload_cache_context,
    _normalize_tipi_query_for_cache_key,
    _request_accepts_tipi_gzip_encoding,
    _validate_tipi_search_query_input,
)
from backend.utils.cache import weak_etag
from backend.utils.ncm_utils import is_code_query


def _normalize_query(ncm: str) -> str:
    return _normalize_tipi_query_for_cache_key(ncm, is_code_query=is_code_query(ncm))


def _build_request_with_accept_encoding(value: str) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/tipi/search",
        "headers": [(b"accept-encoding", value.encode("latin-1"))],
    }
    return Request(scope)


class TestTipiCodeQueryNormalization:
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
        etag_multi = weak_etag("tipi", scope, _normalize_query("85,17"))
        etag_single = weak_etag("tipi", scope, _normalize_query("8517"))
        assert etag_multi != etag_single


class TestTipiTextQueryNormalization:
    def test_case_insensitive(self):
        assert _normalize_query("Capacitor") == _normalize_query("capacitor")

    def test_whitespace_stripped(self):
        assert _normalize_query("  capacitor  ") == _normalize_query("capacitor")

    def test_mixed_case_and_spaces(self):
        assert _normalize_query("  Sem Fio  ") == _normalize_query("sem fio")

    def test_different_terms_different_key(self):
        assert _normalize_query("capacitor") != _normalize_query("resistor")


class TestTipiAcceptsGzip:
    def test_accepts_plain_gzip(self):
        request = _build_request_with_accept_encoding("gzip")
        assert _request_accepts_tipi_gzip_encoding(request) is True

    def test_rejects_gzip_with_zero_quality(self):
        request = _build_request_with_accept_encoding("gzip;q=0")
        assert _request_accepts_tipi_gzip_encoding(request) is False

    def test_accepts_wildcard_with_positive_quality(self):
        request = _build_request_with_accept_encoding("*;q=1")
        assert _request_accepts_tipi_gzip_encoding(request) is True

    def test_rejects_gzip_and_wildcard_with_zero_quality(self):
        request = _build_request_with_accept_encoding("gzip;q=0,*;q=0")
        assert _request_accepts_tipi_gzip_encoding(request) is False


class TestPublicTipiSearchQueryValidation:
    def test_rejects_empty_query(self):
        with pytest.raises(ValidationError, match="Parâmetro 'ncm' é obrigatório"):
            _validate_tipi_search_query_input("")

    def test_rejects_query_above_max_length(self):
        too_long = "x" * (SearchConfig.MAX_QUERY_LENGTH + 1)
        with pytest.raises(ValidationError, match="Query muito longa"):
            _validate_tipi_search_query_input(too_long)

    def test_accepts_non_empty_query_within_limits(self):
        _validate_tipi_search_query_input("8517")


class TestTipiPayloadCacheContext:
    def test_builds_code_query_context(self):
        request = _build_request_with_accept_encoding("gzip")

        context = _build_tipi_payload_cache_context(
            request,
            ncm="85.17",
            view_mode=ViewMode.FAMILY,
        )

        assert context.is_code_query is True
        assert context.normalized_query == "8517"
        assert context.build_code_payload_cache_key().endswith(":family:8517")
        assert (
            context.cache_headers["Vary"]
            == "Authorization, X-Tenant-Id, Accept-Encoding"
        )

    def test_builds_text_query_context(self):
        request = _build_request_with_accept_encoding("gzip")

        context = _build_tipi_payload_cache_context(
            request,
            ncm="motor de arranque",
            view_mode=ViewMode.CHAPTER,
        )

        assert context.is_code_query is False
        assert context.normalized_query == "motor de arranque"
        assert context.build_code_payload_cache_key().endswith(
            ":chapter:motor de arranque"
        )
