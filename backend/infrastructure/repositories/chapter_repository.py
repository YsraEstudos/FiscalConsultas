"""
Repository para operações de Chapter com suporte dual SQLite/PostgreSQL.

Implementa o Repository Pattern abstraindo acesso ao banco de dados
e fornecendo interface unificada para busca FTS.

Suporta multi-tenant via tenant_id filtering.
"""
from typing import Optional, List

from sqlalchemy import select, text, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ...domain.sqlmodels import (
    Chapter, Position, ChapterNotes,
    ChapterRead, PositionRead, ChapterNotesRead,
    SearchResultItem
)
from ...config.settings import settings
from ...utils.id_utils import generate_anchor_id
from ...infrastructure.db_engine import tenant_context


class ChapterRepository:
    """
    Repository para Chapter com busca FTS dual-mode.
    
    Attributes:
        session: AsyncSession do SQLAlchemy
        is_postgres: Se está usando PostgreSQL (FTS via tsvector)
        tenant_id: ID do tenant atual para filtragem multi-tenant
    """
    
    def __init__(self, session: AsyncSession, tenant_id: Optional[str] = None):
        self.session = session
        self.is_postgres = settings.database.is_postgres
        # Use provided tenant_id or get from context
        self.tenant_id = tenant_id or tenant_context.get() or None
    
    async def get_by_num(self, chapter_num: str) -> Optional[Chapter]:
        """
        Busca capítulo com relacionamentos carregados.
        
        Args:
            chapter_num: Número do capítulo (ex: "85")
            
        Returns:
            Chapter com positions e notes carregados, ou None
        """
        stmt = (
            select(Chapter)
            .options(
                joinedload(Chapter.positions),
                joinedload(Chapter.notes)
            )
            .where(Chapter.chapter_num == chapter_num)
        )
        
        # Aplicar filtro de tenant se disponível
        if self.tenant_id:
            stmt = stmt.where(
                or_(
                    Chapter.tenant_id == self.tenant_id,
                    Chapter.tenant_id.is_(None)
                )
            )
        
        result = await self.session.execute(stmt)
        return result.unique().scalar_one_or_none()
    
    async def get_by_num_as_read(self, chapter_num: str) -> Optional[ChapterRead]:
        """
        Busca capítulo e converte para response model.
        
        Returns:
            ChapterRead com positions e notes, ou None
        """
        chapter = await self.get_by_num(chapter_num)
        if not chapter:
            return None
        
        return self._to_read_model(chapter)
    
    def _to_read_model(self, chapter: Chapter) -> ChapterRead:
        """Converte Chapter ORM para ChapterRead response model."""
        positions = [
            PositionRead(
                codigo=p.codigo,
                descricao=p.descricao,
                anchor_id=generate_anchor_id(p.codigo)
            )
            for p in chapter.positions
        ]
        
        notes = None
        if chapter.notes:
            notes = ChapterNotesRead(
                notes_content=chapter.notes.notes_content,
                titulo=chapter.notes.titulo,
                notas=chapter.notes.notas,
                consideracoes=chapter.notes.consideracoes,
                definicoes=chapter.notes.definicoes,
            )
        
        return ChapterRead(
            chapter_num=chapter.chapter_num,
            content=chapter.content,
            positions=positions,
            notes=notes
        )
    
    async def get_all_nums(self) -> List[str]:
        """Lista todos os números de capítulos ordenados."""
        stmt = select(Chapter.chapter_num).order_by(Chapter.chapter_num)
        
        if self.tenant_id:
            stmt = stmt.where(
                or_(
                    Chapter.tenant_id == self.tenant_id,
                    Chapter.tenant_id.is_(None)
                )
            )
        
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
    
    async def search_fulltext(
        self, 
        query: str, 
        limit: int = 50
    ) -> List[SearchResultItem]:
        """
        Busca FTS com suporte dual SQLite/PostgreSQL.
        
        Args:
            query: Termos de busca
            limit: Máximo de resultados
            
        Returns:
            Lista de SearchResultItem ordenados por relevância
        """
        if self.is_postgres:
            return await self._fts_postgres(query, limit)
        else:
            return await self._fts_sqlite(query, limit)
    
    async def _fts_postgres(self, query: str, limit: int) -> List[SearchResultItem]:
        """FTS usando tsvector/tsquery do PostgreSQL."""
        tenant_filter = "AND (p.tenant_id = :tenant_id OR p.tenant_id IS NULL)" if self.tenant_id else ""
        stmt = text(f"""
            SELECT 
                p.codigo as ncm,
                p.descricao as display_text,
                'position' as type,
                p.descricao as description,
                ts_rank(p.search_vector, plainto_tsquery('portuguese', :query)) as score
            FROM positions p
            WHERE p.search_vector @@ plainto_tsquery('portuguese', :query)
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
                tier=1
            )
            for row in result
        ]
    
    async def _fts_sqlite(self, query: str, limit: int) -> List[SearchResultItem]:
        """FTS usando FTS5 do SQLite (compatibilidade)."""
        stmt = text("""
            SELECT 
                ncm,
                display_text,
                type,
                description,
                rank
            FROM search_index
            WHERE indexed_content MATCH :query
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
                tier=1
            )
            for row in result
        ]
    
    async def search_scored(
        self,
        query: str,
        tier: int,
        limit: int,
        words_matched: int = 0,
        total_words: int = 1
    ) -> List[SearchResultItem]:
        """
        Busca FTS com scoring por tier (compatível com lógica existente).
        
        Args:
            query: Query FTS formatada
            tier: Nível do tier (1=exato, 2=AND, 3=OR)
            limit: Máximo de resultados
            words_matched: Palavras encontradas (para coverage bonus)
            total_words: Total de palavras na query
            
        Returns:
            Lista de resultados com score calculado
        """
        tier_bases = {1: 1000, 2: 500, 3: 100}
        base = tier_bases.get(tier, 0)
        coverage_bonus = (words_matched / total_words * 100) if total_words > 0 else 0
        
        results = await self.search_fulltext(query, limit)
        
        for r in results:
            r.score = round(base + r.score + coverage_bonus, 1)
            r.tier = tier
        
        return results
