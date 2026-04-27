import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

import backend.services.nbs_service as nbs_service_module
from backend.config.exceptions import DatabaseNotFoundError, NotFoundError
from backend.config.services_db_schema import (
    CATALOG_METADATA_CREATE_SQL,
    NBS_ITEMS_CREATE_SQL,
    NEBS_ENTRIES_CREATE_SQL,
    NEBS_ENTRIES_FTS_CREATE_SQL,
    SERVICES_INDEXES_SQL,
)
from backend.services.nbs_service import NbsService
from backend.services.nbs.health import build_nbs_health_payload

pytestmark = pytest.mark.unit


def test_nbs_health_payload_keeps_catalog_online_when_explanatory_entries_empty():
    payload = build_nbs_health_payload(12, 0, {})

    assert payload["status"] == "online"
    assert payload["nbs_items"] == 12
    assert payload["nebs_entries"] == 0


@pytest.fixture(autouse=True)
def _reset_pool_state():
    yield


@pytest.mark.asyncio
async def test_initialize_nbs_service_with_postgres_repository_builds_repository_factory(
    monkeypatch,
):
    class _FakeRepository:
        def __init__(self, session):
            self.session = session

    @asynccontextmanager
    async def _fake_get_session():
        yield object()

    monkeypatch.setattr(nbs_service_module, "_REPO_AVAILABLE", True)
    monkeypatch.setattr(nbs_service_module, "get_session", _fake_get_session)
    monkeypatch.setattr(nbs_service_module, "NbsRepository", _FakeRepository)

    service = await NbsService.initializeNbsServiceWithPostgresRepository()

    assert service._use_repository is True
    assert service._repository is None
    assert service._repository_factory is not None
    assert service._pool == []


def _seed_services_db(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(CATALOG_METADATA_CREATE_SQL)
    cursor.execute(NBS_ITEMS_CREATE_SQL)
    cursor.execute(NEBS_ENTRIES_CREATE_SQL)
    cursor.execute(NEBS_ENTRIES_FTS_CREATE_SQL)
    for ddl in SERVICES_INDEXES_SQL:
        cursor.execute(ddl)
    cursor.executemany(
        """
        INSERT INTO nbs_items (
            code, code_clean, description, description_normalized,
            parent_code, level, source_order, sort_path, has_nebs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "1.01",
                "101",
                "Serviços de construção",
                "servicos de construcao",
                None,
                0,
                1,
                "00000001.00000001",
                0,
            ),
            (
                "1.0101",
                "10101",
                "Serviços de construção de edificações",
                "servicos de construcao de edificacoes",
                "1.01",
                1,
                2,
                "00000001.00000101",
                1,
            ),
            (
                "1.0101.1",
                "101011",
                "Serviços residenciais",
                "servicos residenciais",
                "1.0101",
                2,
                3,
                "00000001.00000101.00000001",
                0,
            ),
            (
                "1.0101.11.00",
                "10101100",
                "Serviços residenciais de um e dois pavimentos",
                "servicos residenciais de um e dois pavimentos",
                "1.0101.1",
                3,
                4,
                "00000001.00000101.00000001.00000011.00000000",
                1,
            ),
        ],
    )
    cursor.executemany(
        """
        INSERT INTO nebs_entries (
            code, code_clean, title, title_normalized, body_text, body_markdown,
            body_normalized, section_title, page_start, page_end, parser_status,
            parse_warnings, source_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "1.0101",
                "10101",
                "Serviços de construção de edificações",
                "servicos de construcao de edificacoes",
                "Esta posição inclui serviços de construção de edificações residenciais e comerciais com detalhes suficientes para busca pública.",
                "Esta posição inclui serviços de construção de edificações residenciais e comerciais com detalhes suficientes para busca pública.",
                "esta posicao inclui servicos de construcao de edificacoes residenciais e comerciais com detalhes suficientes para busca publica",
                "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
                21,
                22,
                "trusted",
                None,
                "hash-trusted",
                "2026-03-11T10:00:00+00:00",
            ),
            (
                "1.0101.11.00",
                "10101100",
                "Serviços residenciais de um e dois pavimentos",
                "servicos residenciais de um e dois pavimentos",
                "Esta subposição inclui os serviços de novas construções e reparo em edifícios residenciais de um ou dois pavimentos.",
                "Esta subposição inclui os serviços de novas construções e reparo em edifícios residenciais de um ou dois pavimentos.",
                "esta subposicao inclui os servicos de novas construcoes e reparo em edificios residenciais de um ou dois pavimentos",
                "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
                22,
                23,
                "trusted",
                None,
                "hash-trusted-leaf",
                "2026-03-11T10:00:00+00:00",
            ),
            (
                "1.0101.1",
                "101011",
                "Serviços residenciais",
                "servicos residenciais",
                "Texto curto demais",
                "Texto curto demais",
                "texto curto demais",
                "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
                22,
                22,
                "suspect",
                "corpo_muito_curto",
                "hash-suspect",
                "2026-03-11T10:00:00+00:00",
            ),
        ],
    )
    cursor.executemany(
        """
        INSERT INTO nebs_entries_fts (
            code, title, body_text, section_title
        ) VALUES (?, ?, ?, ?)
        """,
        [
            (
                "1.0101",
                "Serviços de construção de edificações",
                "Esta posição inclui serviços de construção de edificações residenciais e comerciais com detalhes suficientes para busca pública.",
                "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
            ),
            (
                "1.0101.11.00",
                "Serviços residenciais de um e dois pavimentos",
                "Esta subposição inclui os serviços de novas construções e reparo em edifícios residenciais de um ou dois pavimentos.",
                "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
            ),
        ],
    )
    conn.commit()
    conn.close()


class _FakeNbsRepo:
    async def snapshot_nbs_catalog_counts(self):
        return await self.get_catalog_counts()

    async def snapshot_nbs_catalog_metadata(self):
        return await self.get_catalog_metadata()

    async def load_nbs_catalog_entries(self, _query: str, limit: int = 50):
        return await self.search(_query, limit=limit)

    async def load_nbs_catalog_item_details(
        self,
        _code: str,
        *,
        include_tree: bool = True,
        page: int = 1,
        page_size: int = 50,
    ):
        return await self.get_item_details(
            _code,
            include_tree=include_tree,
            page=page,
            page_size=page_size,
        )

    async def load_nbs_catalog_tree_page(
        self, _code: str, *, page: int = 1, page_size: int = 50
    ):
        payload = await self.get_item_details(
            _code,
            include_tree=True,
            page=page,
            page_size=page_size,
        )
        return payload["chapter_page"]

    async def get_catalog_counts(self):
        return {"nbs_items": 12, "nebs_entries": 4}

    async def get_catalog_metadata(self):
        return {
            "nbs_updated_at": "2026-03-25T10:00:00+00:00",
            "nebs_updated_at": "2026-03-25T10:05:00+00:00",
        }

    async def search(self, _query: str, limit: int = 50):
        del limit
        return [
            {
                "code": "1.01",
                "code_clean": "101",
                "description": "Serviços de construção",
                "parent_code": None,
                "level": 0,
            }
        ]

    async def get_item_details(
        self,
        _code: str,
        *,
        include_tree: bool = True,
        page: int = 1,
        page_size: int = 50,
    ):
        chapter_items = [{"code": "1.01"}] if include_tree else []
        return {
            "success": True,
            "item": {"code": "1.01"},
            "ancestors": [],
            "children": [],
            "chapter_root": {"code": "1.01"},
            "chapter_items": chapter_items,
            "chapter_page": {
                "items": chapter_items,
                "page": page,
                "page_size": page_size,
                "total": len(chapter_items),
                "has_more": False,
            },
            "nebs": None,
        }


class _CountingNbsRepo(_FakeNbsRepo):
    def __init__(self, *, tenant_id: str | None = None):
        self.tenant_id = tenant_id
        self.calls = {
            "search": 0,
            "get_item_details": 0,
        }

    async def search(self, query: str, limit: int = 50):
        self.calls["search"] += 1
        return await super().search(query, limit=limit)

    async def get_item_details(self, code: str, **kwargs):
        self.calls["get_item_details"] += 1
        return await super().get_item_details(code, **kwargs)


def _seed_services_db_with_custom_root(
    db_path: Path, root_code: str, root_description: str
) -> None:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(CATALOG_METADATA_CREATE_SQL)
    cursor.execute(NBS_ITEMS_CREATE_SQL)
    cursor.execute(NEBS_ENTRIES_CREATE_SQL)
    cursor.execute(NEBS_ENTRIES_FTS_CREATE_SQL)
    for ddl in SERVICES_INDEXES_SQL:
        cursor.execute(ddl)
    cursor.execute(
        """
        INSERT INTO nbs_items (
            code, code_clean, description, description_normalized,
            parent_code, level, source_order, sort_path, has_nebs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            root_code,
            root_code.replace(".", ""),
            root_description,
            root_description.lower(),
            None,
            0,
            1,
            "00000099.00000099",
            0,
        ),
    )
    conn.commit()
    conn.close()


def _seed_services_db_with_cycle(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(CATALOG_METADATA_CREATE_SQL)
    cursor.execute(NBS_ITEMS_CREATE_SQL)
    cursor.execute(NEBS_ENTRIES_CREATE_SQL)
    cursor.execute(NEBS_ENTRIES_FTS_CREATE_SQL)
    for ddl in SERVICES_INDEXES_SQL:
        cursor.execute(ddl)
    cursor.executemany(
        """
        INSERT INTO nbs_items (
            code, code_clean, description, description_normalized,
            parent_code, level, source_order, sort_path, has_nebs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "1.01",
                "101",
                "Serviços de construção",
                "servicos de construcao",
                "1.0101",
                0,
                1,
                "00000001.00000001",
                0,
            ),
            (
                "1.0101",
                "10101",
                "Serviços de construção de edificações",
                "servicos de construcao de edificacoes",
                "1.01",
                1,
                2,
                "00000001.00000101",
                1,
            ),
        ],
    )
    conn.commit()
    conn.close()


@pytest.mark.asyncio
async def test_search_returns_root_items_when_query_is_empty(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        payload = await service.search("")

    assert payload["success"] is True
    assert [item["code"] for item in payload["results"]] == ["1.01"]


@pytest.mark.asyncio
async def test_search_prioritizes_exact_code_matches(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        payload = await service.search("1.0101")

    assert payload["results"][0]["code"] == "1.0101"


@pytest.mark.asyncio
async def test_get_item_details_returns_ancestors_children_and_chapter_payload(
    tmp_path: Path,
):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        payload = await service.get_item_details("1.0101.11.00")

    assert payload["item"]["code"] == "1.0101.11.00"
    assert [item["code"] for item in payload["ancestors"]] == [
        "1.01",
        "1.0101",
        "1.0101.1",
    ]
    assert payload["children"] == []
    assert payload["chapter_root"]["code"] == "1.0101"
    assert [item["code"] for item in payload["chapter_items"]] == [
        "1.0101",
        "1.0101.1",
        "1.0101.11.00",
    ]
    assert payload["nebs"]["code"] == "1.0101.11.00"
    assert "parser_status" not in payload["nebs"]


@pytest.mark.asyncio
async def test_get_item_details_escapes_html_in_nebs_body_fields(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE nebs_entries
        SET body_text = ?, body_markdown = ?
        WHERE code = ?
        """,
        (
            "<script>alert(1)</script> conteúdo público",
            "<img src=x onerror=alert(1)>\n# Título",
            "1.0101.11.00",
        ),
    )
    conn.commit()
    conn.close()

    async with NbsService(db_path) as service:
        payload = await service.get_item_details("1.0101.11.00")

    assert "<script" not in payload["nebs"]["body_text"]
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in payload["nebs"]["body_text"]
    assert "<img" not in payload["nebs"]["body_markdown"]
    assert "&lt;img src=x onerror=alert(1)&gt;" in payload["nebs"]["body_markdown"]


@pytest.mark.asyncio
async def test_get_item_details_resolves_inline_nebs_by_alias_in_sqlite(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            UPDATE nebs_entries
            SET code = ?, code_clean = ?
            WHERE code = ?
            """,
            ("1.0101.11", "1010111", "1.0101.11.00"),
        )
        conn.execute(
            """
            UPDATE nebs_entries_fts
            SET code = ?
            WHERE code = ?
            """,
            ("1.0101.11", "1.0101.11.00"),
        )
        conn.commit()
    finally:
        conn.close()

    async with NbsService(db_path) as service:
        payload = await service.get_item_details("1.0101.11.00")

    assert payload["item"]["code"] == "1.0101.11.00"
    assert payload["nebs"]["code"] == "1.0101.11"
    assert "parser_status" not in payload["nebs"]


@pytest.mark.asyncio
async def test_search_raises_when_database_is_missing(tmp_path: Path):
    async with NbsService(tmp_path / "missing-services.db") as service:
        with pytest.raises(DatabaseNotFoundError):
            await service.search("")


@pytest.mark.asyncio
async def test_get_item_details_raises_not_found_for_unknown_code(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        with pytest.raises(NotFoundError):
            await service.get_item_details("9.99")


@pytest.mark.asyncio
async def test_get_item_details_stops_on_cyclic_parent_chain(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db_with_cycle(db_path)
    async with NbsService(db_path) as service:
        payload = await service.get_item_details("1.01")

    assert [item["code"] for item in payload["ancestors"]] == ["1.0101"]
    assert payload["chapter_root"]["code"] == "1.01"


@pytest.mark.asyncio
async def test_service_instances_do_not_reuse_connections_from_other_databases(
    tmp_path: Path,
):
    first_db_path = tmp_path / "services-a.db"
    second_db_path = tmp_path / "services-b.db"
    _seed_services_db(first_db_path)
    _seed_services_db_with_custom_root(
        second_db_path, "9.99", "Serviços especiais isolados"
    )
    async with (
        NbsService(first_db_path) as first_service,
        NbsService(second_db_path) as second_service,
    ):
        first_payload = await first_service.search("")
        second_payload = await second_service.search("")
        first_again_payload = await first_service.search("")

    assert [item["code"] for item in first_payload["results"]] == ["1.01"]
    assert [item["code"] for item in second_payload["results"]] == ["9.99"]
    assert [item["code"] for item in first_again_payload["results"]] == ["1.01"]


@pytest.mark.asyncio
async def test_shutdown_nbs_service_resources_clears_only_the_instance_pool(
    tmp_path: Path,
):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    service = NbsService(db_path)

    await service.search("")
    await service.search("1.0101")

    assert len(service._pool) > 0

    await service.shutdownNbsServiceResources()

    assert service._pool == []


@pytest.mark.asyncio
async def test_async_context_manager_closes_pool_on_exit(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)

    service = NbsService(db_path)
    async with service:
        await service.search("")
        assert len(service._pool) > 0

    assert service._pool == []


@pytest.mark.asyncio
async def test_repository_mode_wraps_search_payload():
    service = NbsService(repository=_FakeNbsRepo())

    payload = await service.search("1.01")

    assert payload["success"] is True
    assert payload["normalized"] == "1.01"
    assert payload["results"][0]["code"] == "1.01"
    assert payload["total"] == 1


@pytest.mark.asyncio
async def test_repository_mode_check_connection_exposes_counts_and_metadata():
    service = NbsService(repository=_FakeNbsRepo())

    payload = await service.check_connection()

    assert payload["status"] == "online"
    assert payload["nbs_items"] == 12
    assert payload["nebs_entries"] == 4
    assert payload["metadata"]["nbs_updated_at"] == "2026-03-25T10:00:00+00:00"


@pytest.mark.asyncio
async def test_repository_mode_escapes_html_in_nebs_payload_fields():
    class _MaliciousNbsRepo(_FakeNbsRepo):
        async def get_item_details(self, _code: str, **_kwargs):
            return {
                "success": True,
                "item": {"code": "1.01"},
                "ancestors": [],
                "children": [],
                "chapter_root": {"code": "1.01"},
                "chapter_items": [{"code": "1.01"}],
                "chapter_page": {
                    "items": [{"code": "1.01"}],
                    "page": 1,
                    "page_size": 50,
                    "total": 1,
                    "has_more": False,
                },
                "nebs": {
                    "code": "1.01",
                    "body_text": "<script>alert(1)</script>",
                    "body_markdown": "<img src=x onerror=alert(1)>",
                },
            }

    service = NbsService(repository=_MaliciousNbsRepo())

    item_payload = await service.get_item_details("1.01")

    assert "<script" not in item_payload["nebs"]["body_text"]
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in item_payload["nebs"]["body_text"]
    assert "<img" not in item_payload["nebs"]["body_markdown"]
    assert "&lt;img src=x onerror=alert(1)&gt;" in item_payload["nebs"]["body_markdown"]


@pytest.mark.asyncio
async def test_repository_mode_search_uses_l1_cache_after_first_fetch():
    repo = _CountingNbsRepo(tenant_id="tenant-a")
    service = NbsService(repository=repo)

    first = await service.search("1.01")
    second = await service.search("1.01")

    assert first == second
    assert repo.calls["search"] == 1


@pytest.mark.asyncio
async def test_repository_mode_get_item_details_uses_l1_cache_after_first_fetch():
    repo = _CountingNbsRepo(tenant_id="tenant-a")
    service = NbsService(repository=repo)

    first = await service.get_item_details("1.01")
    second = await service.get_item_details("1.01")

    assert first == second
    assert repo.calls["get_item_details"] == 1


@pytest.mark.asyncio
async def test_repository_mode_cache_keys_are_tenant_scoped():
    tenant_state = {"value": "tenant-a"}
    calls: list[tuple[str | None, str]] = []

    @asynccontextmanager
    async def _repo_factory():
        repo = _CountingNbsRepo(tenant_id=tenant_state["value"])
        original_search = repo.search

        async def _wrapped_search(query: str, limit: int = 50):
            calls.append((repo.tenant_id, query))
            return await original_search(query, limit=limit)

        repo.search = _wrapped_search  # type: ignore[method-assign]
        yield repo

    service = NbsService(repository_factory=_repo_factory)

    await service.search("1.01")
    tenant_state["value"] = "tenant-b"
    await service.search("1.01")

    assert calls == [("tenant-a", "1.01"), ("tenant-b", "1.01")]


@pytest.mark.asyncio
async def test_repository_mode_search_uses_redis_before_repository(monkeypatch):
    repo = _CountingNbsRepo(tenant_id="tenant-a")
    service = NbsService(repository=repo)
    cached_payload = {
        "success": True,
        "query": "1.01",
        "normalized": "1.01",
        "results": [{"code": "1.01"}],
        "total": 1,
    }

    monkeypatch.setattr(nbs_service_module.redis_cache, "_client", object())

    async def _fake_get_services_search(namespace: str, scope: str, key: str):
        assert namespace == "nbs"
        assert scope == "tenant-a"
        assert key
        return cached_payload

    async def _fake_set_services_search(
        namespace: str, scope: str, key: str, value: dict
    ):
        raise AssertionError("Redis set should not run on cache hit")

    monkeypatch.setattr(
        nbs_service_module.redis_cache,
        "get_services_search",
        _fake_get_services_search,
    )
    monkeypatch.setattr(
        nbs_service_module.redis_cache,
        "set_services_search",
        _fake_set_services_search,
    )

    payload = await service.search("1.01")

    assert payload == cached_payload
    assert repo.calls["search"] == 0
