"""
Repository para operações de Position (NCM) com suporte dual SQLite/PostgreSQL.
"""

from typing import Optional, List

from sqlalchemy import select, text, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ...domain.sqlmodels import Position, PositionRead, SearchResultItem
from ...config.settings import settings
from ...utils.id_utils import generate_anchor_id
from ...infrastructure.db_engine import tenant_context


class PositionRepository:
    """
    Repository para Position com busca por código e FTS.

    Attributes:
        session: AsyncSession do SQLAlchemy
        is_postgres: Se está usando PostgreSQL
    """

    def __init__(self, session: AsyncSession, tenant_id: Optional[str] = None):
        self.session = session
        self.is_postgres = settings.database.is_postgres
        self.tenant_id = tenant_id or tenant_context.get() or None

    async def get_by_codigo(self, codigo: str) -> Optional[Position]:
        """
        Busca posição por código NCM exato.

        Args:
            codigo: Código NCM (ex: "8517.12.31")

        Returns:
            Position ou None
        """
        stmt = select(Position).where(Position.codigo == codigo)
        if self.tenant_id:
            stmt = stmt.where(
                or_(Position.tenant_id == self.tenant_id, Position.tenant_id.is_(None))
            )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_chapter(self, chapter_num: str) -> List[PositionRead]:
        """
        Lista todas as posições de um capítulo.

        Args:
            chapter_num: Número do capítulo (ex: "85")

        Returns:
            Lista de PositionRead ordenadas por código
        """
        stmt = (
            select(Position)
            .where(Position.chapter_num == chapter_num)
            .order_by(Position.codigo)
        )
        if self.tenant_id:
            stmt = stmt.where(
                or_(Position.tenant_id == self.tenant_id, Position.tenant_id.is_(None))
            )
        result = await self.session.execute(stmt)
        positions = result.scalars().all()

        return [
            PositionRead(
                codigo=p.codigo,
                descricao=p.descricao,
                anchor_id=generate_anchor_id(p.codigo),
            )
            for p in positions
        ]

    async def search_by_prefix(
        self, prefix: str, limit: int = 50
    ) -> List[PositionRead]:
        """
        Busca posições por prefixo NCM.

        Args:
            prefix: Prefixo NCM (ex: "8517" para buscar 8517.*)
            limit: Máximo de resultados

        Returns:
            Lista de PositionRead
        """
        # Normaliza prefixo (remove pontos)
        clean_prefix = prefix.replace(".", "")

        stmt = (
            select(Position)
            .where(func.replace(Position.codigo, ".", "").like(f"{clean_prefix}%"))
            .order_by(Position.codigo)
            .limit(limit)
        )
        if self.tenant_id:
            stmt = stmt.where(
                or_(Position.tenant_id == self.tenant_id, Position.tenant_id.is_(None))
            )
        result = await self.session.execute(stmt)
        positions = result.scalars().all()

        return [
            PositionRead(
                codigo=p.codigo,
                descricao=p.descricao,
                anchor_id=generate_anchor_id(p.codigo),
            )
            for p in positions
        ]

    async def search_fulltext(
        self, query: str, limit: int = 50
    ) -> List[SearchResultItem]:
        """
        Busca FTS em posições.

        Args:
            query: Termos de busca
            limit: Máximo de resultados

        Returns:
            Lista de SearchResultItem
        """
        if self.is_postgres:
            return await self._fts_postgres(query, limit)
        else:
            return await self._fts_sqlite(query, limit)

    async def _fts_postgres(self, query: str, limit: int) -> List[SearchResultItem]:
        """FTS usando tsvector do PostgreSQL."""
        tenant_filter = (
            "AND (tenant_id = :tenant_id OR tenant_id IS NULL)"
            if self.tenant_id
            else ""
        )
        stmt = text(f"""
            SELECT 
                codigo as ncm,
                descricao as display_text,
                'position' as type,
                descricao as description,
                ts_rank(search_vector, plainto_tsquery('portuguese', :query)) as score
            FROM positions
            WHERE search_vector @@ plainto_tsquery('portuguese', :query)
            {tenant_filter}
            ORDER BY score DESC
            LIMIT :limit
        """)
        params = {"query": query, "limit": limit}
        if self.tenant_id:
            params["tenant_id"] = self.tenant_id
        result = await self.session.execute(stmt, params)
        return [
            SearchResultItem(
                ncm=row.ncm,
                display_text=row.display_text,
                type=row.type,
                description=row.description,
                score=float(row.score) * 100,
                tier=1,
            )
            for row in result
        ]

    async def _fts_sqlite(self, query: str, limit: int) -> List[SearchResultItem]:
        """FTS usando índice FTS5 existente do SQLite."""
        stmt = text("""
            SELECT 
                ncm,
                display_text,
                type,
                description,
                rank
            FROM search_index
            WHERE indexed_content MATCH :query
              AND type = 'position'
            ORDER BY rank
            LIMIT :limit
        """)
        result = await self.session.execute(stmt, {"query": query, "limit": limit})
        return [
            SearchResultItem(
                ncm=row.ncm,
                display_text=row.display_text,
                type=row.type,
                description=row.description,
                score=float(-row.rank) * 10,
                tier=1,
            )
            for row in result
        ]
