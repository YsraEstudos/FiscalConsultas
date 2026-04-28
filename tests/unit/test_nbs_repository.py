import asyncio
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

    def first(self):
        return self._rows[0] if self._rows else None

    def __iter__(self):
        return iter(self._rows)

    def scalar(self):
        if not self._rows:
            return None
        first = self._rows[0]
        return getattr(first, "total", first)


class _FakeSession:
    def __init__(self, results):
        self._results = list(results)
        self.calls = []

    async def execute(self, stmt, params=None):
        await asyncio.sleep(0)
        self.calls.append((stmt, params))
        return self._results.pop(0)


@pytest.mark.asyncio
async def test_search_public_scope_filters_to_null_tenant():
    session = _FakeSession([_FakeRowsResult([])])
    repo = NbsRepository(session)

    results = await repo.load_nbs_catalog_entries("construcao")

    assert results == []
    stmt, params = session.calls[0]
    assert "n.tenant_id IS NULL" in str(stmt)
    assert params is not None
    assert "tenant_id" not in params


@pytest.mark.asyncio
async def test_search_alias_keeps_migration_compatibility():
    legacy_repo = NbsRepository(_FakeSession([_FakeRowsResult([])]))
    canonical_repo = NbsRepository(_FakeSession([_FakeRowsResult([])]))

    legacy_results = await legacy_repo.search("construcao")
    canonical_results = await canonical_repo.load_nbs_catalog_entries("construcao")

    assert legacy_results == canonical_results == []


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

    counts = await repo.snapshot_nbs_catalog_counts()
    metadata = await repo.snapshot_nbs_catalog_metadata()

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


@pytest.mark.asyncio
async def test_get_item_details_public_scope_filters_to_null_tenant():
    session = _FakeSession(
        [
            _FakeRowsResult(
                [
                    SimpleNamespace(
                        code="1.01",
                        code_clean="101",
                        description="Serviços de construção",
                        parent_code=None,
                        level=0,
                        has_nebs=True,
                    )
                ]
            ),
            _FakeRowsResult([]),
            _FakeScalarResult(1),
            _FakeRowsResult([]),
            _FakeRowsResult([]),
        ]
    )
    repo = NbsRepository(session)

    details = await repo.load_nbs_catalog_item_details("1.01")

    assert details["success"] is True
    assert details["item"]["code"] == "1.01"
    assert details["nebs"] is None
    assert details["chapter_page"]["page"] == 1

    assert len(session.calls) == 5
    for stmt, params in session.calls:
        assert "tenant_id IS NULL" in str(stmt)
        assert "tenant_id" not in params


@pytest.mark.asyncio
async def test_get_item_details_inline_nebs_public_scope_filters_to_null_tenant():
    session = _FakeSession(
        [
            _FakeRowsResult(
                [
                    SimpleNamespace(
                        code="1.0102.61.00",
                        code_clean="101026100",
                        description="Serviços de construção",
                        parent_code=None,
                        level=0,
                    )
                ]
            ),
            _FakeRowsResult([]),
            _FakeRowsResult(
                [
                    SimpleNamespace(
                        code="1.0102.61",
                        code_clean="1010261",
                        title="Serviços de construção de usinas",
                        title_normalized="servicos de construcao de usinas",
                        body_text="Conteúdo público",
                        body_markdown="Conteúdo público",
                        body_normalized="conteudo publico",
                        section_title="Seção 1",
                        page_start=1,
                        page_end=2,
                        parser_status="trusted",
                        parse_warnings=None,
                        source_hash="hash",
                        updated_at="2026-04-09",
                    )
                ]
            ),
        ]
    )
    repo = NbsRepository(session)

    details = await repo.load_nbs_catalog_item_details(
        "1.0102.61.00", include_tree=False
    )

    assert details["success"] is True
    assert details["item"]["code"] == "1.0102.61.00"
    assert details["nebs"]["code"] == "1.0102.61"
    assert "parser_status" not in details["nebs"]

    assert len(session.calls) == 3
    for stmt, params in session.calls:
        assert "tenant_id IS NULL" in str(stmt)
        assert "tenant_id" not in params
    nebs_stmt, nebs_params = session.calls[2]
    assert "code_clean" in str(nebs_stmt)
    assert "parser_status = :parser_status" in str(nebs_stmt)
    assert nebs_params["nebs_code_0"] == "1.0102.61.00"
    assert nebs_params["nebs_code_1"] == "1.0102.61"
    assert nebs_params["parser_status"] == "trusted"
