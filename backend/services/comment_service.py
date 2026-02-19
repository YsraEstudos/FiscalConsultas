"""
Service de Comentários — orquestra regras de negócio.

Segue o padrão dos outros services do projeto: camada intermediária
entre routers e repositories, responsável por validações e lógica de domínio.
"""

import logging
from sqlalchemy.ext.asyncio import AsyncSession

from backend.domain.comment_models import Comment
from backend.infrastructure.repositories.comment_repository import CommentRepository
from backend.presentation.schemas.comment_schemas import (
    CommentCreate,
    CommentApproveIn,
    CommentUpdate,
)

logger = logging.getLogger("service.comments")


class CommentService:
    def __init__(self, session: AsyncSession):
        self.repo = CommentRepository(session)

    async def create_comment(
        self,
        data: CommentCreate,
        tenant_id: str,
        user_id: str,
    ) -> Comment:
        """
        Cria um comentário.
        - is_private=True  → status 'private'  (nunca vai para moderação)
        - is_private=False → status 'pending'   (aguarda aprovação admin)
        """
        status = "private" if data.is_private else "pending"
        comment = Comment(
            tenant_id=tenant_id,
            user_id=user_id,
            anchor_key=data.anchor_key,
            selected_text=data.selected_text,
            body=data.body,
            status=status,
            user_name=data.user_name,
            user_image_url=data.user_image_url,
        )
        created = await self.repo.create(comment)
        logger.info(
            "Comentário criado: id=%s tenant=%s user=%s anchor=%s status=%s",
            created.id,
            tenant_id,
            user_id,
            data.anchor_key,
            status,
        )
        return created

    async def list_for_anchor(
        self,
        tenant_id: str,
        anchor_key: str,
        user_id: str,
    ) -> list[Comment]:
        """Comentários aprovados + privados do próprio usuário para o anchor."""
        return await self.repo.list_by_anchor(tenant_id, anchor_key, user_id)

    async def list_pending(self, tenant_id: str) -> list[Comment]:
        """Todos os comentários pendentes para o admin moderar."""
        return await self.repo.list_pending(tenant_id)

    async def moderate(
        self,
        comment_id: int,
        data: CommentApproveIn,
        tenant_id: str,
        admin_user_id: str,
    ) -> Comment:
        """
        Aprova ou rejeita um comentário.
        Somente comentários do mesmo tenant podem ser moderados.
        """
        comment = await self.repo.get_by_id(comment_id)
        if not comment:
            raise ValueError(f"Comentário {comment_id} não encontrado")
        if comment.tenant_id != tenant_id:
            raise PermissionError("Sem permissão para moderar este comentário")

        new_status = "approved" if data.action == "approve" else "rejected"
        updated = await self.repo.update_status(
            comment,
            status=new_status,
            moderated_by=admin_user_id,
            note=data.note,
        )
        logger.info("Comentário %s → %s por %s", comment_id, new_status, admin_user_id)
        return updated

    async def update_comment(
        self,
        comment_id: int,
        data: CommentUpdate,
        tenant_id: str,
        user_id: str,
    ) -> Comment:
        """
        Edita o corpo de um comentário.
        Somente o autor pode editar. Se era aprovado, volta para 'pending'.
        """
        comment = await self.repo.get_by_id(comment_id)
        if not comment:
            raise ValueError(f"Comentário {comment_id} não encontrado")
        if comment.tenant_id != tenant_id:
            raise PermissionError("Sem permissão")
        if comment.user_id != user_id:
            raise PermissionError("Somente o autor pode editar")
        if comment.status == "rejected":
            raise ValueError("Comentário rejeitado não pode ser editado")

        updated = await self.repo.update_body(comment, data.body)
        logger.info("Comentário %s editado por %s", comment_id, user_id)
        return updated

    async def delete_comment(
        self,
        comment_id: int,
        tenant_id: str,
        user_id: str,
    ) -> None:
        """
        Remove definitivamente um comentário.
        Somente o autor pode deletar.
        """
        comment = await self.repo.get_by_id(comment_id)
        if not comment:
            raise ValueError(f"Comentário {comment_id} não encontrado")
        if comment.tenant_id != tenant_id:
            raise PermissionError("Sem permissão")
        if comment.user_id != user_id:
            raise PermissionError("Somente o autor pode deletar")

        await self.repo.delete(comment)
        logger.info("Comentário %s deletado por %s", comment_id, user_id)

    async def get_commented_anchors(self, tenant_id: str) -> list[str]:
        """Lista de anchor_keys com comentários aprovados (para o renderer)."""
        return await self.repo.list_anchors_with_comments(tenant_id)
