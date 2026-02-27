"""
Service de Perfil de Usuário — orquestra regras de negócio.

Segue o padrão dos outros services do projeto: camada intermediária
entre routers e repositories, responsável por validações e lógica de domínio.
"""

import logging
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.domain.comment_models import Comment
from backend.domain.sqlmodels import Tenant, User
from backend.presentation.schemas.profile_schemas import UserProfileUpdate

logger = logging.getLogger("service.profile")


class ProfileService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_profile(
        self,
        user_id: str,
        tenant_id: str,
        image_url: Optional[str] = None,
    ) -> dict:
        """
        Retorna perfil completo do usuário com estatísticas de contribuição.

        Combina dados do User (DB local) com contagens de comentários.
        O image_url vem do Clerk JWT (não armazenamos avatar localmente).
        """
        user = await self.session.get(User, user_id)
        if not user:
            raise ValueError(f"Usuário {user_id} não encontrado")

        tenant = await self.session.get(Tenant, tenant_id)

        # Contagem de comentários por status
        count_query = (
            select(
                func.count().label("total"),
                func.count().filter(Comment.status == "approved").label("approved"),
                func.count().filter(Comment.status == "pending").label("pending"),
            )
            .where(Comment.user_id == user_id)
            .where(Comment.tenant_id == tenant_id)
        )
        result = await self.session.execute(count_query)
        row = result.one()

        return {
            "user_id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "bio": user.bio,
            "image_url": image_url,
            "tenant_id": tenant_id,
            "org_name": tenant.name if tenant else None,
            "is_active": user.is_active,
            "comment_count": row.total,
            "approved_comment_count": row.approved,
            "pending_comment_count": row.pending,
        }

    async def update_bio(
        self,
        user_id: str,
        tenant_id: str,
        data: UserProfileUpdate,
    ) -> dict:
        """Atualiza a bio do usuário."""
        user = await self.session.get(User, user_id)
        if not user:
            raise ValueError(f"Usuário {user_id} não encontrado")

        user.bio = data.bio
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)

        logger.info("Bio atualizada para user=%s tenant=%s", user_id, tenant_id)
        return await self.get_profile(user_id, tenant_id)

    async def get_contributions(
        self,
        user_id: str,
        tenant_id: str,
        page: int = 1,
        page_size: int = 20,
        search: Optional[str] = None,
        status_filter: Optional[str] = None,
    ) -> dict:
        """
        Lista paginada de contribuições (comentários) do usuário.

        Suporta busca por texto e filtro por status.
        """
        page_size = min(max(page_size, 1), 100)
        page = max(page, 1)
        offset = (page - 1) * page_size

        # Base query
        base_query = (
            select(Comment)
            .where(Comment.user_id == user_id)
            .where(Comment.tenant_id == tenant_id)
        )

        if status_filter:
            base_query = base_query.where(Comment.status == status_filter)

        if search:
            search_term = f"%{search}%"
            base_query = base_query.where(
                Comment.body.ilike(search_term)
                | Comment.selected_text.ilike(search_term)
                | Comment.anchor_key.ilike(search_term)
            )

        # Count total
        count_query = select(func.count()).select_from(base_query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Fetch page
        items_query = (
            base_query.order_by(Comment.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        result = await self.session.execute(items_query)
        items = result.scalars().all()

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_next": (offset + page_size) < total,
        }

    async def get_user_card(self, user_id: str) -> dict:
        """
        Mini-card público de um usuário.

        Retorna dados mínimos para o hover tooltip em comentários.
        """
        user = await self.session.get(User, user_id)
        if not user:
            raise ValueError(f"Usuário {user_id} não encontrado")

        # Count total approved comments
        count_query = (
            select(func.count())
            .where(Comment.user_id == user_id)
            .where(Comment.status == "approved")
        )
        count = (await self.session.execute(count_query)).scalar() or 0

        return {
            "user_id": user.id,
            "full_name": user.full_name,
            "bio": user.bio,
            "image_url": None,  # Clerk image resolved on frontend
            "comment_count": count,
        }

    async def delete_account(self, user_id: str, tenant_id: str) -> None:
        """
        Remove conta do usuário.

        1. Deleta comentários do usuário no tenant
        2. Desativa o usuário local (soft delete)
        3. A chamada real ao Clerk Backend API para eliminar a conta Clerk
           é feita no router (requer HTTP client + secret key).
        """
        user = await self.session.get(User, user_id)
        if not user:
            raise ValueError(f"Usuário {user_id} não encontrado")

        # Soft delete: marca como inativo
        user.is_active = False
        user.bio = None
        self.session.add(user)
        await self.session.commit()

        logger.info("Conta desativada: user=%s tenant=%s", user_id, tenant_id)
