"""
Repository para operações da TIPI (Tabela de Incidência do IPI).

Suporta multi-tenant via tenant_id filtering.
Suporta dual SQLite/PostgreSQL similar ao ChapterRepository.
"""

from typing import Optional, List, Tuple, Dict, Any, Set

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ...domain.sqlmodels import TipiPosition, SearchResultItem
from ...config.settings import settings
from ...utils.id_utils import generate_anchor_id
from ...infrastructure.db_engine import tenant_context


class TipiRepository:
    """
    Repository para TipiPosition com busca por código e FTS.

    Attributes:
        session: AsyncSession do SQLAlchemy
        is_postgres: Se está usando PostgreSQL
        tenant_id: ID do tenant atual para filtragem multi-tenant
    """

    def __init__(self, session: AsyncSession, tenant_id: Optional[str] = None):
        self.session = session
        self.is_postgres = settings.database.is_postgres
        self.tenant_id = tenant_id or tenant_context.get() or None

    async def get_by_codigo(self, codigo: str) -> Optional[TipiPosition]:
        """
        Busca posição TIPI por código NCM exato.

        Args:
            codigo: Código NCM (ex: "8517.12.31")

        Returns:
            TipiPosition ou None
        """
        stmt = select(TipiPosition).where(TipiPosition.codigo == codigo)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_chapter(self, chapter_num: str) -> List[Dict[str, Any]]:
        """
        Lista todas as posições de um capítulo TIPI.

        Args:
            chapter_num: Número do capítulo (ex: "85")

        Returns:
            Lista de dicts com ncm, descricao, aliquota, nivel
        """
        order_primary = (
            TipiPosition.ncm_sort
            if hasattr(TipiPosition, "ncm_sort")
            else TipiPosition.codigo
        )
        stmt = (
            select(TipiPosition)
            .where(TipiPosition.chapter_num == chapter_num)
            .order_by(order_primary, TipiPosition.codigo)
        )
        result = await self.session.execute(stmt)
        positions = result.scalars().all()

        return [
            {
                "ncm": p.codigo,
                "codigo": p.codigo,
                "capitulo": p.chapter_num,
                "descricao": p.descricao,
                "aliquota": p.aliquota or "0",
                "nivel": p.nivel or 0,
                "parent_ncm": p.parent_ncm,
                "anchor_id": generate_anchor_id(p.codigo),
            }
            for p in positions
        ]

    async def get_family_positions(
        self, chapter_num: str, prefix: str, ancestor_prefixes: Set[str]
    ) -> List[Dict[str, Any]]:
        """
        Busca posições filtradas por família NCM.

        Args:
            chapter_num: Número do capítulo
            prefix: Prefixo NCM para filtrar descendentes
            ancestor_prefixes: Set de prefixos ancestrais
        """
        if self.is_postgres:
            # PostgreSQL: usar REPLACE e LIKE
            conditions = ["REPLACE(codigo, '.', '') LIKE :prefix || '%'"]
            params = {"chapter_num": chapter_num, "prefix": prefix}

            for i, ancestor in enumerate(ancestor_prefixes):
                conditions.append(f"REPLACE(codigo, '.', '') = :ancestor{i}")
                params[f"ancestor{i}"] = ancestor

            where_clause = " OR ".join(conditions)
            stmt = text(f"""
                SELECT codigo, chapter_num, descricao, aliquota, nivel, parent_ncm, ncm_sort
                FROM tipi_positions
                WHERE chapter_num = :chapter_num AND ({where_clause})
                ORDER BY ncm_sort, codigo
            """)
        else:
            # SQLite: mesma lógica
            conditions = ["REPLACE(ncm, '.', '') LIKE ? || '%'"]
            params_list = [chapter_num, prefix]

            for ancestor in ancestor_prefixes:
                conditions.append("REPLACE(ncm, '.', '') = ?")
                params_list.append(ancestor)

            where_clause = " OR ".join(conditions)
            stmt = text(f"""
                SELECT ncm as codigo, capitulo as chapter_num, descricao, aliquota, nivel, parent_ncm, ncm_sort
                FROM tipi_positions
                WHERE capitulo = ? AND ({where_clause})
                ORDER BY ncm_sort, ncm
            """)
            params = tuple(params_list)

        result = await self.session.execute(stmt, params)

        return [
            {
                "ncm": row.codigo,
                "codigo": row.codigo,
                "capitulo": row.chapter_num,
                "descricao": row.descricao,
                "aliquota": row.aliquota or "0",
                "nivel": getattr(row, "nivel", 0) or 0,
                "parent_ncm": getattr(row, "parent_ncm", None),
                "anchor_id": generate_anchor_id(row.codigo),
            }
            for row in result
        ]

    async def search_fulltext(
        self, query: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Busca FTS em posições TIPI.

        Args:
            query: Termos de busca
            limit: Máximo de resultados

        Returns:
            Lista de dicts com ncm, capitulo, descricao, aliquota
        """
        if self.is_postgres:
            return await self._fts_postgres(query, limit)
        else:
            return await self._fts_sqlite(query, limit)

    async def _fts_postgres(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """FTS usando tsvector do PostgreSQL."""
        stmt = text("""
            SELECT 
                codigo as ncm,
                chapter_num as capitulo,
                descricao,
                aliquota,
                ts_rank(search_vector, plainto_tsquery('portuguese', :query)) as score
            FROM tipi_positions
            WHERE search_vector @@ plainto_tsquery('portuguese', :query)
            ORDER BY score DESC
            LIMIT :limit
        """)
        result = await self.session.execute(stmt, {"query": query, "limit": limit})
        return [
            {
                "ncm": row.ncm,
                "capitulo": row.capitulo,
                "descricao": row.descricao,
                "aliquota": row.aliquota or "0",
            }
            for row in result
        ]

    async def _fts_sqlite(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """FTS usando FTS5 do SQLite."""
        stmt = text("""
            SELECT ncm, capitulo, descricao, aliquota
            FROM tipi_fts
            WHERE tipi_fts MATCH :query
            LIMIT :limit
        """)
        result = await self.session.execute(
            stmt, {"query": f'"{query}"', "limit": limit}
        )
        return [
            {
                "ncm": row.ncm,
                "capitulo": row.capitulo,
                "descricao": row.descricao,
                "aliquota": row.aliquota or "0",
            }
            for row in result
        ]

    async def get_all_chapters(self) -> List[Dict[str, str]]:
        """Lista todos os capítulos TIPI."""
        if self.is_postgres:
            stmt = text("""
                SELECT DISTINCT chapter_num as codigo, chapter_num as titulo
                FROM tipi_positions
                ORDER BY chapter_num
            """)
        else:
            stmt = text("""
                SELECT codigo, titulo, secao
                FROM tipi_chapters
                ORDER BY codigo
            """)

        result = await self.session.execute(stmt)
        return [dict(row._mapping) for row in result]
