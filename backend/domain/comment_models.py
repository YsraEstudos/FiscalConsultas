"""
Modelo SQLModel para Comentários Contextuais.

Segue o padrão de sqlmodels.py: SQLModel dual (ORM + schema Pydantic),
com suporte a multi-tenancy via tenant_id.
"""

from datetime import datetime, timezone
from typing import Optional, Literal
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, Text


CommentStatus = Literal["pending", "approved", "rejected", "private"]


class Comment(SQLModel, table=True):
    """
    Comentário contextual ancorado a um trecho de texto.

    anchor_key: identifica o elemento HTML onde o comentário foi criado
                (ex: 'ncm-8517.12.31' via data-anchor-id no frontend).
    selected_text: snapshot do texto selecionado no momento da criação.
    status:
        - 'private'  → visível apenas ao autor
        - 'pending'  → aguardando moderação admin
        - 'approved' → visível a todos os usuários do tenant
        - 'rejected' → moderado/removido pelo admin
    """

    __tablename__ = "comments"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: str = Field(max_length=255, index=True)
    user_id: str = Field(max_length=255, index=True)

    # Localização do comentário no conteúdo
    anchor_key: str = Field(max_length=255, index=True)
    selected_text: str = Field(sa_column=Column(Text))

    # Conteúdo do comentário
    body: str = Field(sa_column=Column(Text))

    # Dados do autor (desnormalizados para evitar chamada ao Clerk)
    user_name: Optional[str] = Field(default=None, max_length=255)
    user_image_url: Optional[str] = Field(default=None, max_length=1024)

    # Ciclo de vida
    status: str = Field(default="pending", max_length=20, index=True)

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Moderação
    moderated_by: Optional[str] = Field(default=None, max_length=255)
    moderated_at: Optional[datetime] = Field(default=None)
    moderation_note: Optional[str] = Field(default=None, sa_column=Column(Text))
