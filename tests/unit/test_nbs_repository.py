from types import SimpleNamespace

import pytest

from backend.infrastructure.repositories.nbs_repository import NbsRepository

pytestmark = pytest.mark.unit


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _FakeRowsResult:
    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class _FakeSession:
    def __init__(self, results):
        self._results = list(results)
        self.calls = []

    async def execute(self, stmt, params=None):
        self.calls.append((stmt, params))
        return self._results.pop(0)


@pytest.mark.asyncio
async def test_search_public_scope_filters_to_null_tenant():
    session = _FakeSession([_FakeRowsResult([])])
    repo = NbsRepository(session)

    results = await repo.search("construcao")

    assert results == []
    stmt, params = session.calls[0]
    assert "n.tenant_id IS NULL" in str(stmt)
    assert params is not None
    assert "tenant_id" not in params


@pytest.mark.asyncio
async def test_catalog_counts_and_metadata_public_scope_filter_to_null_tenant():
    session = _FakeSession(
        [
            _FakeScalarResult(12),
            _FakeScalarResult(8),
            _FakeRowsResult([SimpleNamespace(key="nbs_version", value="2026-04")]),
        ]
    )
    repo = NbsRepository(session)

    counts = await repo.get_catalog_counts()
    metadata = await repo.get_catalog_metadata()

    assert counts == {"nbs_items": 12, "nebs_entries": 8}
    assert metadata == {"nbs_version": "2026-04"}

    counts_stmt_1, counts_params_1 = session.calls[0]
    counts_stmt_2, counts_params_2 = session.calls[1]
    metadata_stmt, metadata_params = session.calls[2]

    assert "nbs_items.tenant_id IS NULL" in str(counts_stmt_1)
    assert "nebs_entries.tenant_id IS NULL" in str(counts_stmt_2)
    assert "catalog_metadata.tenant_id IS NULL" in str(metadata_stmt)
    assert counts_params_1 == {}
    assert counts_params_2 == {}
    assert metadata_params == {}
