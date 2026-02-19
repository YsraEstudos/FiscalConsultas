"""
Repository de Comentários — camada de acesso a dados.

Segue o padrão Repository do projeto: isolamento da lógica SQL
para facilitar testes e troca de banco de dados.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.domain.comment_models import Comment

logger = logging.getLogger("repository.comments")


class CommentRepository:
    """Operações de banco de dados para Comentários."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, comment: Comment) -> Comment:
        self.session.add(comment)
        await self.session.flush()  # Garante id antes do commit
        await self.session.refresh(comment)
        return comment

    async def get_by_id(self, comment_id: int) -> Optional[Comment]:
        return await self.session.get(Comment, comment_id)

    async def list_by_anchor(
        self,
        tenant_id: str,
        anchor_key: str,
        user_id: str,
    ) -> list[Comment]:
        """
        Retorna comentários aprovados + comentários privados do próprio usuário
        para um dado anchor_key.
        """
        stmt = (
            select(Comment)
            .where(Comment.tenant_id == tenant_id)
            .where(Comment.anchor_key == anchor_key)
            .where(
                (Comment.status == "approved")
                | ((Comment.status == "private") & (Comment.user_id == user_id))
            )
            .order_by(Comment.created_at)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_pending(self, tenant_id: str) -> list[Comment]:
        """Retorna todos os comentários pendentes de moderação para o tenant."""
        stmt = (
            select(Comment)
            .where(Comment.tenant_id == tenant_id)
            .where(Comment.status == "pending")
            .order_by(Comment.created_at)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_anchors_with_comments(self, tenant_id: str) -> list[str]:
        """
        Retorna lista de anchor_keys que possuem comentários aprovados,
        usada pelo renderer para injetar <mark class='has-comment'>.
        """
        from sqlalchemy import distinct

        stmt = (
            select(distinct(Comment.anchor_key))
            .where(Comment.tenant_id == tenant_id)
            .where(Comment.status == "approved")
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def update_status(
        self,
        comment: Comment,
        status: str,
        moderated_by: str,
        note: Optional[str] = None,
    ) -> Comment:
        comment.status = status
        comment.moderated_by = moderated_by
        comment.moderated_at = datetime.now(timezone.utc)
        comment.updated_at = datetime.now(timezone.utc)
        if note:
            comment.moderation_note = note
        self.session.add(comment)
        await self.session.flush()
        await self.session.refresh(comment)
        return comment

    async def update_body(self, comment: Comment, body: str) -> Comment:
        """Atualiza o corpo do comentário (edição pelo autor)."""
        comment.body = body
        comment.updated_at = datetime.now(timezone.utc)
        # Se era aprovado, volta para moderação após edição
        if comment.status == "approved":
            comment.status = "pending"
        self.session.add(comment)
        await self.session.flush()
        await self.session.refresh(comment)
        return comment

    async def delete(self, comment: Comment) -> None:
        """Remove permanentemente um comentário."""
        await self.session.delete(comment)
        await self.session.flush()
