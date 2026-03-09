import pytest

from backend.infrastructure.repositories.postgres_fts import build_postgres_tsquery

pytestmark = pytest.mark.unit


def test_build_postgres_tsquery_uses_phrase_query_for_non_empty_quoted_search():
    spec = build_postgres_tsquery('"motor centrif"')

    assert spec.sql == "phraseto_tsquery('portuguese', :query)"
    assert spec.params == {"query": "motor centrif"}


def test_build_postgres_tsquery_returns_empty_spec_for_empty_quoted_search():
    spec = build_postgres_tsquery('""')

    assert spec.sql == "NULL::tsquery"
    assert spec.params == {}
