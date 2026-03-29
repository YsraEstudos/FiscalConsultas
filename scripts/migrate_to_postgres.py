"""Migrate all fiscal catalogs into PostgreSQL.

This script loads:
- NESH from the legacy SQLite database
- TIPI from the legacy TIPI SQLite database
- NBS from ``data/nbs.csv``
- NEBS from ``data/nebs.pdf`` (trusted entries only)

It also refreshes PostgreSQL FTS vectors and persists load metadata into
``catalog_metadata`` so the runtime health endpoints can expose freshness.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import aiosqlite
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.config.settings import settings  # noqa: E402
from backend.domain.sqlmodels import (  # noqa: E402
    CatalogMetadata,
    Chapter,
    ChapterNotes,
    Glossary,
    NbsItem,
    NebsEntry,
    Position,
    TipiPosition,
)
from backend.infrastructure.db_engine import get_session  # noqa: E402
from backend.utils.hash_util import calculate_file_sha256  # noqa: E402
from backend.utils.nbs_parser import (  # noqa: E402
    build_nbs_items,
    iter_nbs_rows,
)
from backend.utils.nebs_parser import (  # noqa: E402
    parse_nebs_pdf,
    write_nebs_audit_report,
)

DATA_DIR = PROJECT_ROOT / "data"
REPORTS_DIR = PROJECT_ROOT / "reports" / "nebs"
NBS_CSV_PATH = DATA_DIR / "nbs.csv"
NEBS_PDF_PATH = DATA_DIR / "nebs.pdf"
NEBS_AUDIT_CSV_PATH = REPORTS_DIR / "nebs_audit.csv"
NEBS_AUDIT_JSON_PATH = REPORTS_DIR / "nebs_audit.json"


def _mask_database_url(url: str | None) -> str:
    """Mask database credentials for safe logging."""
    if not url:
        return "<not configured>"

    parsed = urlsplit(url)
    if not parsed.scheme:
        return "<invalid database url>"

    host = parsed.hostname or "localhost"
    port = f":{parsed.port}" if parsed.port else ""
    path = parsed.path or ""
    credentials = f"{parsed.username}:***@" if parsed.username else ""
    return urlunsplit((parsed.scheme, f"{credentials}{host}{port}", path, "", ""))


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _coerce_pg_timestamp(value: str | datetime) -> datetime:
    """Convert ISO timestamps into naive UTC datetimes for PostgreSQL."""
    if isinstance(value, datetime):
        timestamp = value
    else:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))

    if timestamp.tzinfo is not None:
        timestamp = timestamp.astimezone(UTC).replace(tzinfo=None)

    return timestamp


def _build_metadata_entries(
    prefix: str, values: dict[str, str]
) -> list[dict[str, str | None]]:
    return [
        {"key": f"{prefix}_{key}", "value": value, "tenant_id": None}
        for key, value in values.items()
    ]


def _choose_preferred_position(
    current: dict[str, str | None] | None,
    candidate: dict[str, str | None],
) -> dict[str, str | None]:
    """Pick the best row for a duplicated NESH position code."""
    if current is None:
        return candidate

    def score(record: dict[str, str | None]) -> tuple[int, int, int]:
        description = (record.get("descricao") or "").strip()
        is_generic = description.lower().startswith("item generico")
        has_anchor = 1 if record.get("anchor_id") else 0
        return (0 if is_generic else 1, has_anchor, len(description))

    return candidate if score(candidate) > score(current) else current


async def _replace_metadata(
    pg_session: AsyncSession, *, prefix: str, values: dict[str, str]
) -> None:
    await pg_session.execute(
        text("DELETE FROM catalog_metadata WHERE key LIKE :prefix"),
        {"prefix": f"{prefix}_%"},
    )
    rows = _build_metadata_entries(prefix, values)
    if not rows:
        return
    stmt = pg_insert(CatalogMetadata).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"],
        set_={"value": stmt.excluded.value, "tenant_id": None},
    )
    await pg_session.execute(stmt)


async def _reset_runtime_catalog(pg_session: AsyncSession) -> None:
    """Clear global/runtime catalog rows so imports stay idempotent."""
    statements = (
        "DELETE FROM nebs_entries WHERE tenant_id IS NULL",
        "DELETE FROM nbs_items WHERE tenant_id IS NULL",
        "DELETE FROM catalog_metadata WHERE key LIKE 'nesh_%' OR key LIKE 'tipi_%' OR key LIKE 'nbs_%' OR key LIKE 'nebs_%'",
        "DELETE FROM chapter_notes WHERE tenant_id IS NULL",
        "DELETE FROM positions WHERE tenant_id IS NULL",
        "DELETE FROM chapters WHERE tenant_id IS NULL",
        "DELETE FROM glossary",
        "DELETE FROM tipi_positions",
    )
    for sql in statements:
        await pg_session.execute(text(sql))


async def _load_runtime_metadata(pg_session: AsyncSession) -> dict[str, str]:
    result = await pg_session.execute(text("""
            SELECT key, value
            FROM catalog_metadata
            WHERE tenant_id IS NULL
            """))
    return {row.key: row.value for row in result}


async def _load_runtime_counts(pg_session: AsyncSession) -> dict[str, int]:
    queries = {
        "nesh_chapters": "SELECT COUNT(*) FROM chapters WHERE tenant_id IS NULL",
        "tipi_positions": "SELECT COUNT(*) FROM tipi_positions",
        "nbs_items": "SELECT COUNT(*) FROM nbs_items WHERE tenant_id IS NULL",
        "nebs_entries": "SELECT COUNT(*) FROM nebs_entries WHERE tenant_id IS NULL",
    }
    counts: dict[str, int] = {}
    for key, sql in queries.items():
        result = await pg_session.execute(text(sql))
        counts[key] = int(result.scalar_one() or 0)
    return counts


async def _catalog_sync_reasons(pg_session: AsyncSession) -> list[str]:
    metadata = await _load_runtime_metadata(pg_session)
    counts = await _load_runtime_counts(pg_session)

    expected_hashes = {
        "nesh_source_hash": calculate_file_sha256(settings.database.path),
        "tipi_source_hash": calculate_file_sha256(settings.database.tipi_path),
        "nbs_source_hash": calculate_file_sha256(NBS_CSV_PATH),
        "nebs_source_hash": calculate_file_sha256(NEBS_PDF_PATH),
    }
    count_requirements = {
        "nesh_chapters": 1,
        "tipi_positions": 1,
        "nbs_items": 1,
        "nebs_entries": 1,
    }

    reasons: list[str] = []
    for key, expected_hash in expected_hashes.items():
        current_hash = metadata.get(key)
        if current_hash != expected_hash:
            reasons.append(f"{key} changed")

    for key, minimum in count_requirements.items():
        if counts.get(key, 0) < minimum:
            reasons.append(f"{key} missing")

    return reasons


async def check_sync_needed() -> int:
    """Return exit code indicating whether runtime catalogs need a fresh sync."""
    if not settings.database.is_postgres:
        print("ERRO: verificacao de sincronizacao exige PostgreSQL configurado.")
        return 2

    required_sources = (
        Path(settings.database.path),
        Path(settings.database.tipi_path),
        NBS_CSV_PATH,
        NEBS_PDF_PATH,
    )
    missing_sources = [str(path) for path in required_sources if not path.exists()]
    if missing_sources:
        print("ERRO: fontes obrigatorias ausentes para verificar sincronizacao.")
        for path in missing_sources:
            print(f"  - {path}")
        return 2

    async with get_session() as session:
        reasons = await _catalog_sync_reasons(session)

    if reasons:
        print("Sincronizacao de catalogos necessaria:")
        for reason in reasons:
            print(f"  - {reason}")
        return 10

    print("Catalogos em PostgreSQL ja estao sincronizados com as fontes atuais.")
    return 0


async def migrate_chapters(sqlite_path: str, pg_session: AsyncSession) -> int:
    """Migrate chapters from SQLite into PostgreSQL."""
    count = 0
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row

        async with db.execute("PRAGMA table_info(chapters)") as cursor:
            columns = [row[1] async for row in cursor]
        has_raw_text = "raw_text" in columns

        query = (
            "SELECT chapter_num, content, raw_text FROM chapters"
            if has_raw_text
            else "SELECT chapter_num, content FROM chapters"
        )
        batch: list[dict[str, str | None]] = []
        async with db.execute(query) as cursor:
            async for row in cursor:
                batch.append(
                    {
                        "chapter_num": row["chapter_num"],
                        "content": row["content"],
                        "raw_text": row["raw_text"] if has_raw_text else None,
                        "tenant_id": None,
                    }
                )
                count += 1
                if len(batch) >= 500:
                    stmt = pg_insert(Chapter).values(batch)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["chapter_num"],
                        set_={
                            "content": stmt.excluded.content,
                            "raw_text": stmt.excluded.raw_text,
                            "tenant_id": None,
                        },
                    )
                    await pg_session.execute(stmt)
                    batch = []

        if batch:
            stmt = pg_insert(Chapter).values(batch)
            stmt = stmt.on_conflict_do_update(
                index_elements=["chapter_num"],
                set_={
                    "content": stmt.excluded.content,
                    "raw_text": stmt.excluded.raw_text,
                    "tenant_id": None,
                },
            )
            await pg_session.execute(stmt)

    print(f"  OK {count} capítulos NESH migrados")
    return count


async def migrate_positions(sqlite_path: str, pg_session: AsyncSession) -> int:
    """Migrate NESH positions from SQLite into PostgreSQL."""
    source_count = 0
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("PRAGMA table_info(positions)") as cursor:
            columns = [row[1] async for row in cursor]
        has_anchor = "anchor_id" in columns

        query = (
            "SELECT codigo, descricao, chapter_num, anchor_id FROM positions"
            if has_anchor
            else "SELECT codigo, descricao, chapter_num FROM positions"
        )
        unique_positions: dict[str, dict[str, str | None]] = {}
        async with db.execute(query) as cursor:
            async for row in cursor:
                candidate = {
                    "codigo": row["codigo"],
                    "descricao": row["descricao"],
                    "chapter_num": row["chapter_num"],
                    "anchor_id": row["anchor_id"] if has_anchor else None,
                    "tenant_id": None,
                }
                unique_positions[candidate["codigo"]] = _choose_preferred_position(
                    unique_positions.get(candidate["codigo"]),
                    candidate,
                )
                source_count += 1

        deduped_positions = list(unique_positions.values())
        for start in range(0, len(deduped_positions), 1000):
            batch = deduped_positions[start : start + 1000]
            stmt = pg_insert(Position).values(batch)
            stmt = stmt.on_conflict_do_update(
                index_elements=["codigo"],
                set_={
                    "descricao": stmt.excluded.descricao,
                    "chapter_num": stmt.excluded.chapter_num,
                    "anchor_id": stmt.excluded.anchor_id,
                    "tenant_id": None,
                },
            )
            await pg_session.execute(stmt)

    deduped_count = len(deduped_positions)
    if deduped_count != source_count:
        print(
            f"  OK {deduped_count} posições NESH migradas "
            f"(deduplicadas de {source_count} linhas SQLite)"
        )
    else:
        print(f"  OK {deduped_count} posições NESH migradas")
    return deduped_count


async def migrate_chapter_notes(sqlite_path: str, pg_session: AsyncSession) -> int:
    """Migrate chapter notes from SQLite into PostgreSQL."""
    count = 0
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row
        try:
            async with db.execute("PRAGMA table_info(chapter_notes)") as cursor:
                columns = [row[1] async for row in cursor]
            has_parsed = "parsed_notes_json" in columns

            query = (
                "SELECT chapter_num, notes_content, titulo, notas, consideracoes, definicoes, parsed_notes_json FROM chapter_notes"
                if has_parsed
                else "SELECT chapter_num, notes_content, titulo, notas, consideracoes, definicoes FROM chapter_notes"
            )
            batch: list[dict[str, str | None]] = []
            async with db.execute(query) as cursor:
                async for row in cursor:
                    batch.append(
                        {
                            "chapter_num": row["chapter_num"],
                            "notes_content": row["notes_content"],
                            "titulo": row["titulo"],
                            "notas": row["notas"],
                            "consideracoes": row["consideracoes"],
                            "definicoes": row["definicoes"],
                            "parsed_notes_json": (
                                row["parsed_notes_json"] if has_parsed else None
                            ),
                            "tenant_id": None,
                        }
                    )
                    count += 1
                    if len(batch) >= 500:
                        stmt = pg_insert(ChapterNotes).values(batch)
                        stmt = stmt.on_conflict_do_update(
                            index_elements=["chapter_num"],
                            set_={
                                "notes_content": stmt.excluded.notes_content,
                                "titulo": stmt.excluded.titulo,
                                "notas": stmt.excluded.notas,
                                "consideracoes": stmt.excluded.consideracoes,
                                "definicoes": stmt.excluded.definicoes,
                                "parsed_notes_json": stmt.excluded.parsed_notes_json,
                                "tenant_id": None,
                            },
                        )
                        await pg_session.execute(stmt)
                        batch = []

            if batch:
                stmt = pg_insert(ChapterNotes).values(batch)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["chapter_num"],
                    set_={
                        "notes_content": stmt.excluded.notes_content,
                        "titulo": stmt.excluded.titulo,
                        "notas": stmt.excluded.notas,
                        "consideracoes": stmt.excluded.consideracoes,
                        "definicoes": stmt.excluded.definicoes,
                        "parsed_notes_json": stmt.excluded.parsed_notes_json,
                        "tenant_id": None,
                    },
                )
                await pg_session.execute(stmt)
        except Exception as exc:
            print(f"  AVISO ao migrar chapter_notes: {exc}")

    print(f"  OK {count} notas de capítulo migradas")
    return count


async def migrate_glossary(sqlite_path: str, pg_session: AsyncSession) -> int:
    """Migrate glossary terms from SQLite into PostgreSQL."""
    count = 0
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row
        try:
            batch: list[dict[str, str]] = []
            async with db.execute("SELECT term, definition FROM glossary") as cursor:
                async for row in cursor:
                    batch.append({"term": row["term"], "definition": row["definition"]})
                    count += 1
                    if len(batch) >= 500:
                        stmt = pg_insert(Glossary).values(batch)
                        stmt = stmt.on_conflict_do_update(
                            index_elements=["term"],
                            set_={"definition": stmt.excluded.definition},
                        )
                        await pg_session.execute(stmt)
                        batch = []

            if batch:
                stmt = pg_insert(Glossary).values(batch)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["term"],
                    set_={"definition": stmt.excluded.definition},
                )
                await pg_session.execute(stmt)
        except Exception as exc:
            print(f"  AVISO ao migrar glossary: {exc}")

    print(f"  OK {count} termos do glossário migrados")
    return count


async def migrate_tipi_positions(
    sqlite_path: str, pg_session: AsyncSession
) -> tuple[int, int]:
    """Migrate TIPI positions from SQLite into PostgreSQL."""
    if not os.path.exists(sqlite_path):
        raise FileNotFoundError(f"TIPI SQLite não encontrado: {sqlite_path}")

    count = 0
    chapters: set[str] = set()
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row
        batch: list[dict[str, str | int | None]] = []
        async with db.execute(
            "SELECT ncm, capitulo, descricao, aliquota, nivel, parent_ncm, ncm_sort FROM tipi_positions"
        ) as cursor:
            async for row in cursor:
                chapters.add(str(row["capitulo"]))
                batch.append(
                    {
                        "codigo": row["ncm"],
                        "descricao": row["descricao"],
                        "aliquota": row["aliquota"],
                        "chapter_num": row["capitulo"],
                        "nivel": row["nivel"],
                        "parent_ncm": row["parent_ncm"],
                        "ncm_sort": row["ncm_sort"],
                    }
                )
                count += 1
                if len(batch) >= 2000:
                    stmt = pg_insert(TipiPosition).values(batch)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["codigo"],
                        set_={
                            "descricao": stmt.excluded.descricao,
                            "aliquota": stmt.excluded.aliquota,
                            "chapter_num": stmt.excluded.chapter_num,
                            "nivel": stmt.excluded.nivel,
                            "parent_ncm": stmt.excluded.parent_ncm,
                            "ncm_sort": stmt.excluded.ncm_sort,
                        },
                    )
                    await pg_session.execute(stmt)
                    batch = []

        if batch:
            stmt = pg_insert(TipiPosition).values(batch)
            stmt = stmt.on_conflict_do_update(
                index_elements=["codigo"],
                set_={
                    "descricao": stmt.excluded.descricao,
                    "aliquota": stmt.excluded.aliquota,
                    "chapter_num": stmt.excluded.chapter_num,
                    "nivel": stmt.excluded.nivel,
                    "parent_ncm": stmt.excluded.parent_ncm,
                    "ncm_sort": stmt.excluded.ncm_sort,
                },
            )
            await pg_session.execute(stmt)

    print(f"  OK {count} posições TIPI migradas")
    return count, len(chapters)


async def migrate_nbs_items(csv_path: Path, pg_session: AsyncSession) -> list:
    """Load the NBS CSV into PostgreSQL."""
    if not csv_path.exists():
        raise FileNotFoundError(f"Arquivo NBS não encontrado: {csv_path}")

    items = build_nbs_items(iter_nbs_rows(csv_path))
    batch: list[dict[str, str | int | bool | None]] = []
    for item in items:
        batch.append(
            {
                "code": item.code,
                "code_clean": item.code_clean,
                "description": item.description,
                "description_normalized": item.description_normalized,
                "parent_code": item.parent_code,
                "level": item.level,
                "source_order": item.source_order,
                "sort_path": item.sort_path,
                "has_nebs": bool(item.has_nebs),
                "tenant_id": None,
            }
        )
        if len(batch) >= 1000:
            stmt = pg_insert(NbsItem).values(batch)
            stmt = stmt.on_conflict_do_update(
                index_elements=["code"],
                set_={
                    "code_clean": stmt.excluded.code_clean,
                    "description": stmt.excluded.description,
                    "description_normalized": stmt.excluded.description_normalized,
                    "parent_code": stmt.excluded.parent_code,
                    "level": stmt.excluded.level,
                    "source_order": stmt.excluded.source_order,
                    "sort_path": stmt.excluded.sort_path,
                    "has_nebs": stmt.excluded.has_nebs,
                    "tenant_id": None,
                },
            )
            await pg_session.execute(stmt)
            batch = []

    if batch:
        stmt = pg_insert(NbsItem).values(batch)
        stmt = stmt.on_conflict_do_update(
            index_elements=["code"],
            set_={
                "code_clean": stmt.excluded.code_clean,
                "description": stmt.excluded.description,
                "description_normalized": stmt.excluded.description_normalized,
                "parent_code": stmt.excluded.parent_code,
                "level": stmt.excluded.level,
                "source_order": stmt.excluded.source_order,
                "sort_path": stmt.excluded.sort_path,
                "has_nebs": stmt.excluded.has_nebs,
                "tenant_id": None,
            },
        )
        await pg_session.execute(stmt)

    print(f"  OK {len(items)} itens NBS migrados")
    return items


async def migrate_nebs_entries(
    pdf_path: Path,
    *,
    valid_nbs_items: dict[str, str],
    pg_session: AsyncSession,
) -> dict[str, int]:
    """Load trusted NEBS entries into PostgreSQL and persist audit artifacts."""
    if not pdf_path.exists():
        raise FileNotFoundError(f"Arquivo NEBS não encontrado: {pdf_path}")

    outcome = parse_nebs_pdf(pdf_path, valid_nbs_items=valid_nbs_items)
    write_nebs_audit_report(
        outcome,
        csv_path=NEBS_AUDIT_CSV_PATH,
        json_path=NEBS_AUDIT_JSON_PATH,
    )

    batch: list[dict[str, str | int | datetime | None]] = []
    for entry in outcome.entries:
        batch.append(
            {
                "code": entry.code,
                "code_clean": entry.code_clean,
                "title": entry.title,
                "title_normalized": entry.title_normalized,
                "body_text": entry.body_text,
                "body_markdown": entry.body_markdown,
                "body_normalized": entry.body_normalized,
                "section_title": entry.section_title,
                "page_start": entry.page_start,
                "page_end": entry.page_end,
                "parser_status": entry.parser_status,
                "parse_warnings": entry.parse_warnings,
                "source_hash": entry.source_hash,
                "updated_at": _coerce_pg_timestamp(entry.updated_at),
                "tenant_id": None,
            }
        )
        if len(batch) >= 500:
            stmt = pg_insert(NebsEntry).values(batch)
            stmt = stmt.on_conflict_do_update(
                index_elements=["code"],
                set_={
                    "code_clean": stmt.excluded.code_clean,
                    "title": stmt.excluded.title,
                    "title_normalized": stmt.excluded.title_normalized,
                    "body_text": stmt.excluded.body_text,
                    "body_markdown": stmt.excluded.body_markdown,
                    "body_normalized": stmt.excluded.body_normalized,
                    "section_title": stmt.excluded.section_title,
                    "page_start": stmt.excluded.page_start,
                    "page_end": stmt.excluded.page_end,
                    "parser_status": stmt.excluded.parser_status,
                    "parse_warnings": stmt.excluded.parse_warnings,
                    "source_hash": stmt.excluded.source_hash,
                    "updated_at": stmt.excluded.updated_at,
                    "tenant_id": None,
                },
            )
            await pg_session.execute(stmt)
            batch = []

    if batch:
        stmt = pg_insert(NebsEntry).values(batch)
        stmt = stmt.on_conflict_do_update(
            index_elements=["code"],
            set_={
                "code_clean": stmt.excluded.code_clean,
                "title": stmt.excluded.title,
                "title_normalized": stmt.excluded.title_normalized,
                "body_text": stmt.excluded.body_text,
                "body_markdown": stmt.excluded.body_markdown,
                "body_normalized": stmt.excluded.body_normalized,
                "section_title": stmt.excluded.section_title,
                "page_start": stmt.excluded.page_start,
                "page_end": stmt.excluded.page_end,
                "parser_status": stmt.excluded.parser_status,
                "parse_warnings": stmt.excluded.parse_warnings,
                "source_hash": stmt.excluded.source_hash,
                "updated_at": stmt.excluded.updated_at,
                "tenant_id": None,
            },
        )
        await pg_session.execute(stmt)

    trusted_codes = [entry.code for entry in outcome.entries]
    if trusted_codes:
        await pg_session.execute(
            text("UPDATE nbs_items SET has_nebs = false WHERE tenant_id IS NULL")
        )
        await pg_session.execute(
            text("UPDATE nbs_items SET has_nebs = true WHERE code = ANY(:codes)"),
            {"codes": trusted_codes},
        )

    print(f"  OK {outcome.counts['trusted']} entradas NEBS confiáveis migradas")
    print(f"  OK auditoria NEBS atualizada em {NEBS_AUDIT_CSV_PATH}")
    return outcome.counts


async def update_search_vectors(pg_session: AsyncSession) -> None:
    """Refresh PostgreSQL tsvector columns after bulk loads."""
    print("\nAtualizando search_vectors...")

    await pg_session.execute(text("""
            UPDATE chapters
            SET search_vector = to_tsvector('portuguese', COALESCE(content, ''))
            """))
    await pg_session.execute(text("""
            UPDATE positions
            SET search_vector = to_tsvector('portuguese', COALESCE(descricao, ''))
            """))
    await pg_session.execute(text("""
            UPDATE tipi_positions
            SET search_vector = to_tsvector('portuguese', COALESCE(descricao, ''))
            """))
    await pg_session.execute(text("""
            UPDATE nbs_items
            SET search_vector = to_tsvector('portuguese', COALESCE(description, ''))
            """))
    await pg_session.execute(text("""
            UPDATE nebs_entries
            SET search_vector = to_tsvector(
                'portuguese',
                trim(
                    COALESCE(title, '') || ' ' ||
                    COALESCE(section_title, '') || ' ' ||
                    COALESCE(body_text, '')
                )
            )
            """))

    print("  OK search vectors atualizados")


async def run_full_migration() -> int:
    """Run the full PostgreSQL catalog migration."""
    print("=" * 60)
    print("Migracao consolidada para PostgreSQL")
    print("=" * 60)

    if not settings.database.is_postgres:
        print("\nERRO: DATABASE__ENGINE deve ser 'postgresql'")
        print("Configure no .env:")
        print("  DATABASE__ENGINE=postgresql")
        print("  DATABASE__POSTGRES_URL=postgresql+asyncpg://user:pass@host/db")
        return 1

    required_sources = {
        "nesh_sqlite": Path(settings.database.path),
        "tipi_sqlite": Path(settings.database.tipi_path),
        "nbs_csv": NBS_CSV_PATH,
        "nebs_pdf": NEBS_PDF_PATH,
    }
    missing_sources = [
        f"{name}: {path}"
        for name, path in required_sources.items()
        if not path.exists()
    ]
    if missing_sources:
        print("\nERRO: fontes obrigatórias ausentes:")
        for missing in missing_sources:
            print(f"  - {missing}")
        return 1

    print(f"\nSQLite NESH source: {settings.database.path}")
    print(f"SQLite TIPI source: {settings.database.tipi_path}")
    print(f"NBS source: {NBS_CSV_PATH}")
    print(f"NEBS source: {NEBS_PDF_PATH}")
    print(f"PostgreSQL target: {_mask_database_url(settings.database.postgres_url)}")

    nesh_updated_at = _now_iso()
    tipi_updated_at = _now_iso()
    nbs_updated_at = _now_iso()
    nebs_updated_at = _now_iso()

    try:
        async with get_session() as session:
            await _reset_runtime_catalog(session)

            print("\nMigrando NESH...")
            nesh_chapters = await migrate_chapters(settings.database.path, session)
            nesh_positions = await migrate_positions(settings.database.path, session)
            nesh_notes = await migrate_chapter_notes(settings.database.path, session)
            nesh_glossary = await migrate_glossary(settings.database.path, session)
            await _replace_metadata(
                session,
                prefix="nesh",
                values={
                    "source_path": settings.database.path,
                    "source_hash": calculate_file_sha256(settings.database.path),
                    "chapters": str(nesh_chapters),
                    "positions": str(nesh_positions),
                    "chapter_notes": str(nesh_notes),
                    "glossary_terms": str(nesh_glossary),
                    "updated_at": nesh_updated_at,
                },
            )

            print("\nMigrando TIPI...")
            tipi_positions, tipi_chapters = await migrate_tipi_positions(
                settings.database.tipi_path, session
            )
            await _replace_metadata(
                session,
                prefix="tipi",
                values={
                    "source_path": settings.database.tipi_path,
                    "source_hash": calculate_file_sha256(settings.database.tipi_path),
                    "chapters": str(tipi_chapters),
                    "positions": str(tipi_positions),
                    "updated_at": tipi_updated_at,
                },
            )

            print("\nMigrando NBS...")
            nbs_items = await migrate_nbs_items(NBS_CSV_PATH, session)
            await _replace_metadata(
                session,
                prefix="nbs",
                values={
                    "source_path": str(NBS_CSV_PATH),
                    "source_hash": calculate_file_sha256(NBS_CSV_PATH),
                    "row_count": str(len(nbs_items)),
                    "updated_at": nbs_updated_at,
                },
            )

            print("\nMigrando NEBS...")
            nebs_counts = await migrate_nebs_entries(
                NEBS_PDF_PATH,
                valid_nbs_items={item.code: item.description for item in nbs_items},
                pg_session=session,
            )
            await _replace_metadata(
                session,
                prefix="nebs",
                values={
                    "source_path": str(NEBS_PDF_PATH),
                    "source_hash": calculate_file_sha256(NEBS_PDF_PATH),
                    "trusted_count": str(nebs_counts.get("trusted", 0)),
                    "suspect_count": str(nebs_counts.get("suspect", 0)),
                    "rejected_count": str(nebs_counts.get("rejected", 0)),
                    "updated_at": nebs_updated_at,
                    "audit_csv": str(NEBS_AUDIT_CSV_PATH),
                    "audit_json": str(NEBS_AUDIT_JSON_PATH),
                },
            )

            await update_search_vectors(session)
    except Exception as exc:
        print(f"\nERRO durante a migracao: {exc}")
        raise

    print("\n" + "=" * 60)
    print("Migracao concluida com sucesso")
    print("=" * 60)
    print("\nValidacoes sugeridas:")
    print("  1. uv run python scripts/migrate_to_postgres.py")
    print("  2. curl http://127.0.0.1:8000/api/status/details")
    print("  3. Testar /api/search, /api/tipi/search e /api/services/*")
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sincroniza catalogos fiscais runtime no PostgreSQL."
    )
    parser.add_argument(
        "--check-needed",
        action="store_true",
        help="Retorna 10 quando a sincronizacao e necessaria; 0 quando pode ser pulada.",
    )
    return parser.parse_args()


async def main() -> int:
    args = _parse_args()
    if args.check_needed:
        return await check_sync_needed()
    return await run_full_migration()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
