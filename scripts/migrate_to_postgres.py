"""
Script de migração de dados: SQLite → PostgreSQL.

Este script:
1. Lê todos os dados dos bancos SQLite (nesh.db, tipi.db)
2. Insere no PostgreSQL usando SQLModel
3. Atualiza os search_vectors para FTS

Uso:
    python scripts/migrate_to_postgres.py

Pré-requisitos:
    1. PostgreSQL rodando e acessível
    2. DATABASE__ENGINE=postgresql no .env
    3. DATABASE__POSTGRES_URL configurado
    4. Rodar: alembic upgrade head
"""

import asyncio
import os
import sys
from urllib.parse import urlsplit, urlunsplit

import aiosqlite
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config.settings import settings
from backend.domain.sqlmodels import (
    Chapter,
    ChapterNotes,
    Glossary,
    Position,
    TipiPosition,
)
from backend.infrastructure.db_engine import get_session

# Adicionar root ao path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _mask_database_url(url: str | None) -> str:
    """Mascara credenciais em URLs de banco para logs seguros."""
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


async def migrate_chapters(sqlite_path: str, pg_session: AsyncSession) -> int:
    """Migra tabela chapters do SQLite para PostgreSQL (catálogo global)."""
    count = 0
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row

        # Check if raw_text column exists
        async with db.execute("PRAGMA table_info(chapters)") as cursor:
            columns = [row[1] async for row in cursor]
        has_raw_text = "raw_text" in columns

        if has_raw_text:
            query = "SELECT chapter_num, content, raw_text FROM chapters"
        else:
            query = "SELECT chapter_num, content FROM chapters"
        async with db.execute(query) as cursor:
            async for row in cursor:
                chapter = Chapter(
                    chapter_num=row["chapter_num"],
                    content=row["content"],
                    raw_text=row["raw_text"] if has_raw_text else None,
                    tenant_id=None,
                )
                pg_session.add(chapter)
                count += 1
    print(f"  ✅ {count} capítulos migrados")
    return count


async def migrate_positions(sqlite_path: str, pg_session: AsyncSession) -> int:
    """Migra tabela positions do SQLite para PostgreSQL (catálogo global)."""
    count = 0
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row
        # Check if anchor_id exists
        async with db.execute("PRAGMA table_info(positions)") as cursor:
            columns = [row[1] async for row in cursor]
        has_anchor = "anchor_id" in columns

        if has_anchor:
            query = "SELECT codigo, descricao, chapter_num, anchor_id FROM positions"
        else:
            query = "SELECT codigo, descricao, chapter_num FROM positions"
        batch = []
        async with db.execute(query) as cursor:
            async for row in cursor:
                batch.append(
                    {
                        "codigo": row["codigo"],
                        "descricao": row["descricao"],
                        "chapter_num": row["chapter_num"],
                        "anchor_id": row["anchor_id"] if has_anchor else None,
                        "tenant_id": None,
                    }
                )
                count += 1
                if len(batch) >= 1000:
                    stmt = pg_insert(Position).values(batch)
                    stmt = stmt.on_conflict_do_nothing(index_elements=["codigo"])
                    await pg_session.execute(stmt)
                    batch = []
        if batch:
            stmt = pg_insert(Position).values(batch)
            stmt = stmt.on_conflict_do_nothing(index_elements=["codigo"])
            await pg_session.execute(stmt)
    print(f"  ✅ {count} posições migradas")
    return count


async def migrate_chapter_notes(sqlite_path: str, pg_session: AsyncSession) -> int:
    """Migra tabela chapter_notes do SQLite para PostgreSQL (catálogo global)."""
    count = 0
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row
        try:
            async with db.execute("PRAGMA table_info(chapter_notes)") as cursor:
                columns = [row[1] async for row in cursor]
            has_parsed = "parsed_notes_json" in columns

            if has_parsed:
                query = (
                    "SELECT chapter_num, notes_content, titulo, notas, consideracoes, "
                    "definicoes, parsed_notes_json FROM chapter_notes"
                )
            else:
                query = (
                    "SELECT chapter_num, notes_content, titulo, notas, consideracoes, "
                    "definicoes FROM chapter_notes"
                )
            async with db.execute(query) as cursor:
                async for row in cursor:
                    notes = ChapterNotes(
                        chapter_num=row["chapter_num"],
                        notes_content=row["notes_content"],
                        titulo=row["titulo"],
                        notas=row["notas"],
                        consideracoes=row["consideracoes"],
                        definicoes=row["definicoes"],
                        parsed_notes_json=(
                            row["parsed_notes_json"] if has_parsed else None
                        ),
                        tenant_id=None,
                    )
                    pg_session.add(notes)
                    count += 1
        except Exception as e:
            print(f"  ⚠️ Aviso ao migrar chapter_notes: {e}")
    print(f"  ✅ {count} notas de capítulo migradas")
    return count


async def migrate_glossary(sqlite_path: str, pg_session: AsyncSession) -> int:
    """Migra tabela glossary do SQLite para PostgreSQL."""
    count = 0
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row
        try:
            async with db.execute("SELECT term, definition FROM glossary") as cursor:
                async for row in cursor:
                    glossary = Glossary(
                        term=row["term"],
                        definition=row["definition"],
                    )
                    pg_session.add(glossary)
                    count += 1
        except Exception as e:
            print(f"  ⚠️ Aviso ao migrar glossary: {e}")
    print(f"  ✅ {count} termos do glossário migrados")
    return count


async def migrate_tipi_positions(sqlite_path: str, pg_session: AsyncSession) -> int:
    """Migra tabela TIPI do SQLite para PostgreSQL (catálogo global)."""
    if not os.path.exists(sqlite_path):
        print(f"  ⚠️ TIPI SQLite não encontrado: {sqlite_path} (pulando)")
        return 0

    count = 0
    async with aiosqlite.connect(sqlite_path) as db:
        db.row_factory = aiosqlite.Row
        batch = []
        async with db.execute(
            "SELECT ncm, capitulo, descricao, aliquota, nivel, parent_ncm, ncm_sort FROM tipi_positions"  # noqa: E501
        ) as cursor:
            async for row in cursor:
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
                    stmt = stmt.on_conflict_do_nothing(index_elements=["codigo"])
                    await pg_session.execute(stmt)
                    batch = []
        if batch:
            stmt = pg_insert(TipiPosition).values(batch)
            stmt = stmt.on_conflict_do_nothing(index_elements=["codigo"])
            await pg_session.execute(stmt)
    print(f"  ✅ {count} posições TIPI migradas")
    return count


async def update_search_vectors(pg_session: AsyncSession):
    """
    Força atualização dos search_vectors em registros existentes.
    Necessário porque os triggers só disparam em INSERT/UPDATE.
    """
    from sqlalchemy import text

    print("\n📊 Atualizando search_vectors...")

    await pg_session.execute(
        text("""
        UPDATE chapters
        SET search_vector = to_tsvector('portuguese', COALESCE(content, ''))
    """)
    )

    await pg_session.execute(
        text("""
        UPDATE positions
        SET search_vector = to_tsvector('portuguese', COALESCE(descricao, ''))
    """)
    )

    await pg_session.execute(
        text("""
        UPDATE tipi_positions
        SET search_vector = to_tsvector('portuguese', COALESCE(descricao, ''))
    """)
    )

    print("  ✅ Search vectors atualizados")


async def main():
    """Função principal de migração."""
    print("=" * 60)
    print("🚀 Migração SQLite → PostgreSQL")
    print("=" * 60)

    # Verificar se está configurado para PostgreSQL
    if not settings.database.is_postgres:
        print("\n❌ Erro: DATABASE__ENGINE deve ser 'postgresql'")
        print("   Configure no .env:")
        print("   DATABASE__ENGINE=postgresql")
        print("   DATABASE__POSTGRES_URL=postgresql+asyncpg://user:pass@host/db")
        return

    print(f"\n📁 SQLite source: {settings.database.path}")
    print(f"🐘 PostgreSQL target: {_mask_database_url(settings.database.postgres_url)}")

    # Verificar se SQLite existe
    if not os.path.exists(settings.database.path):
        print(f"\n❌ Erro: Banco SQLite não encontrado: {settings.database.path}")
        return

    print("\n" + "-" * 60)
    print("📦 Migrando dados...")
    print("-" * 60)

    try:
        async with get_session() as session:
            async with session.begin():
                # Migrar tabelas na ordem correta (FK constraints)
                await migrate_chapters(settings.database.path, session)
                await migrate_positions(settings.database.path, session)
                await migrate_chapter_notes(settings.database.path, session)
                await migrate_glossary(settings.database.path, session)
                await migrate_tipi_positions(settings.database.tipi_path, session)

                # Atualizar search_vectors
                await update_search_vectors(session)
    except Exception as exc:
        print(f"\n❌ Erro durante a migração: {exc}")
        raise

    print("\n" + "=" * 60)
    print("✅ Migração concluída com sucesso!")
    print("=" * 60)
    print("\nPróximos passos:")
    # NOSONAR - local manual check
    print("  1. Testar busca: curl 'http://localhost:8000/api/search?ncm=bomba'")
    print(
        "  2. Verificar FTS: psql -d nesh_db -c \"SELECT codigo, ts_headline('portuguese', descricao, plainto_tsquery('portuguese', 'bomba')) FROM positions WHERE search_vector @@ plainto_tsquery('portuguese', 'bomba') LIMIT 5;\""  # noqa: E501
    )


if __name__ == "__main__":
    asyncio.run(main())
