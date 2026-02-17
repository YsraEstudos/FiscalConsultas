"""Tests for cache-key normalization in the search route.

Ensures that equivalent queries (e.g. "85.17", "8517", " 8517 ") produce
the same ETag and payload-cache key, improving hit-rate and reducing
memory/compute waste.
"""

from backend.utils.cache import weak_etag
from backend.utils.ncm_utils import clean_ncm, is_code_query


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

def _normalize_query(ncm: str) -> str:
    """Mirror the normalization logic from search route."""
    if is_code_query(ncm):
        return clean_ncm(ncm)
    return ncm.strip().lower()


# ---------------------------------------------------------------------------
# Code queries – digits/punctuation only
# ---------------------------------------------------------------------------

class TestCodeQueryNormalization:
    """Equivalent numeric queries must produce identical cache keys."""

    def test_dotted_and_plain_same_etag(self):
        a = _normalize_query("85.17")
        b = _normalize_query("8517")
        assert a == b == "8517"

    def test_whitespace_stripped(self):
        a = _normalize_query(" 8517 ")
        b = _normalize_query("8517")
        assert a == b

    def test_dashes_removed(self):
        a = _normalize_query("85.17-10")
        b = _normalize_query("851710")
        assert a == b == "851710"

    def test_full_ncm_formats_converge(self):
        variants = ["8413.91.90", "84139190", "8413-91-90", "8413 91 90"]
        normalized = {_normalize_query(v) for v in variants}
        assert len(normalized) == 1
        assert normalized.pop() == "84139190"

    def test_weak_etag_identical_for_equivalent_queries(self):
        scope = "public"
        etag_a = weak_etag("nesh", scope, _normalize_query("85.17"))
        etag_b = weak_etag("nesh", scope, _normalize_query("8517"))
        etag_c = weak_etag("nesh", scope, _normalize_query(" 85 17 "))
        assert etag_a == etag_b == etag_c

    def test_different_codes_different_etag(self):
        scope = "public"
        etag_a = weak_etag("nesh", scope, _normalize_query("8517"))
        etag_b = weak_etag("nesh", scope, _normalize_query("8413"))
        assert etag_a != etag_b


# ---------------------------------------------------------------------------
# Text queries – free-form search terms
# ---------------------------------------------------------------------------

class TestTextQueryNormalization:
    """Text queries are normalized by strip + lowercase."""

    def test_case_insensitive(self):
        a = _normalize_query("Capacitor")
        b = _normalize_query("capacitor")
        assert a == b

    def test_whitespace_stripped(self):
        a = _normalize_query("  capacitor  ")
        b = _normalize_query("capacitor")
        assert a == b

    def test_mixed_case_and_spaces(self):
        a = _normalize_query("  Sem Fio  ")
        b = _normalize_query("sem fio")
        assert a == b

    def test_different_terms_different_key(self):
        a = _normalize_query("capacitor")
        b = _normalize_query("resistor")
        assert a != b
