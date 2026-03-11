import sqlite3
from pathlib import Path

import pytest
from backend.config.exceptions import DatabaseNotFoundError, NotFoundError
from backend.config.services_db_schema import (
    CATALOG_METADATA_CREATE_SQL,
    NEBS_ENTRIES_CREATE_SQL,
    NEBS_ENTRIES_FTS_CREATE_SQL,
    NBS_ITEMS_CREATE_SQL,
    SERVICES_INDEXES_SQL,
)
from backend.services.nbs_service import NbsService

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _reset_pool_state():
    yield


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
            ("1.01", "101", "Serviços de construção", "servicos de construcao", None, 0, 1, "00000001.00000001", 0),
            ("1.0101", "10101", "Serviços de construção de edificações", "servicos de construcao de edificacoes", "1.01", 1, 2, "00000001.00000101", 1),
            ("1.0101.1", "101011", "Serviços residenciais", "servicos residenciais", "1.0101", 2, 3, "00000001.00000101.00000001", 0),
            ("1.0101.11.00", "10101100", "Serviços residenciais de um e dois pavimentos", "servicos residenciais de um e dois pavimentos", "1.0101.1", 3, 4, "00000001.00000101.00000001.00000011.00000000", 1),
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


def _seed_services_db_with_custom_root(db_path: Path, root_code: str, root_description: str) -> None:
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
async def test_get_item_details_returns_ancestors_children_and_chapter_payload(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        payload = await service.get_item_details("1.0101.11.00")

    assert payload["item"]["code"] == "1.0101.11.00"
    assert [item["code"] for item in payload["ancestors"]] == ["1.01", "1.0101", "1.0101.1"]
    assert payload["children"] == []
    assert payload["chapter_root"]["code"] == "1.0101"
    assert [item["code"] for item in payload["chapter_items"]] == ["1.0101", "1.0101.1", "1.0101.11.00"]
    assert payload["nebs"]["code"] == "1.0101.11.00"
    assert "parser_status" not in payload["nebs"]



@pytest.mark.asyncio
async def test_search_nebs_matches_full_nbs_code_against_canonical_nebs_entry(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        payload = await service.search_nebs("1.0101.11.00")

    assert payload["success"] is True
    assert payload["results"][0]["code"] == "1.0101.11.00"


@pytest.mark.asyncio
async def test_search_nebs_returns_only_trusted_entries_and_prioritizes_exact_code(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        payload = await service.search_nebs("1.0101")

    assert payload["success"] is True
    assert payload["total"] == 2
    assert payload["results"][0]["code"] == "1.0101"
    assert "busca pública" in payload["results"][0]["excerpt"]


@pytest.mark.asyncio
async def test_search_nebs_uses_fts_for_body_terms(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        payload = await service.search_nebs("novas construcoes reparo")

    assert payload["success"] is True
    assert payload["results"][0]["code"] == "1.0101.11.00"


@pytest.mark.asyncio
async def test_search_nebs_with_empty_query_returns_empty_result_set(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        payload = await service.search_nebs("")

    assert payload["success"] is True
    assert payload["results"] == []
    assert payload["total"] == 0


@pytest.mark.asyncio
async def test_get_nebs_details_resolves_short_nebs_code_to_canonical_nbs_entry(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        payload = await service.get_nebs_details("1.0101.11")

    assert payload["item"]["code"] == "1.0101.11.00"
    assert [item["code"] for item in payload["ancestors"]] == ["1.01", "1.0101", "1.0101.1"]
    assert payload["entry"]["code"] == "1.0101.11.00"
    assert payload["entry"]["section_title"] == "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO"


@pytest.mark.asyncio
async def test_get_nebs_details_raises_not_found_for_non_trusted_entry(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    async with NbsService(db_path) as service:
        with pytest.raises(NotFoundError):
            await service.get_nebs_details("1.0101.1")


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
async def test_service_instances_do_not_reuse_connections_from_other_databases(tmp_path: Path):
    first_db_path = tmp_path / "services-a.db"
    second_db_path = tmp_path / "services-b.db"
    _seed_services_db(first_db_path)
    _seed_services_db_with_custom_root(second_db_path, "9.99", "Serviços especiais isolados")
    async with NbsService(first_db_path) as first_service, NbsService(second_db_path) as second_service:
        first_payload = await first_service.search("")
        second_payload = await second_service.search("")
        first_again_payload = await first_service.search("")

    assert [item["code"] for item in first_payload["results"]] == ["1.01"]
    assert [item["code"] for item in second_payload["results"]] == ["9.99"]
    assert [item["code"] for item in first_again_payload["results"]] == ["1.01"]


@pytest.mark.asyncio
async def test_close_clears_only_the_instance_pool(tmp_path: Path):
    db_path = tmp_path / "services.db"
    _seed_services_db(db_path)
    service = NbsService(db_path)

    await service.search("")
    await service.search("1.0101")

    assert len(service._pool) > 0

    await service.close()

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
