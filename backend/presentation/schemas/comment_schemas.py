"""
Schemas Pydantic para a API de Comentários.

Separados do modelo ORM para controle explícito de serialização
e validação nas entradas/saídas da API.
"""

from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator


class CommentCreate(BaseModel):
    """Payload para criação de comentário (POST /api/comments/)."""

    anchor_key: str = Field(
        min_length=1, max_length=255, description="ID do elemento âncora no HTML"
    )
    selected_text: str = Field(min_length=1, max_length=5000)
    body: str = Field(min_length=1, max_length=4000)
    is_private: bool = Field(
        default=False, description="True → status=private, False → status=pending"
    )
    user_name: Optional[str] = Field(
        default=None, max_length=255, description="Nome do autor (do Clerk frontend)"
    )
    user_image_url: Optional[str] = Field(
        default=None, max_length=1024, description="URL do avatar (do Clerk frontend)"
    )

    @field_validator("anchor_key", "body", "selected_text")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


class CommentOut(BaseModel):
    """Schema de resposta para um comentário."""

    id: int
    tenant_id: str
    user_id: str
    anchor_key: str
    selected_text: str
    body: str
    status: Literal["pending", "approved", "rejected", "private"]
    created_at: datetime
    updated_at: datetime
    moderated_by: Optional[str] = None
    moderated_at: Optional[datetime] = None
    user_name: Optional[str] = None
    user_image_url: Optional[str] = None

    model_config = {"from_attributes": True}


class CommentUpdate(BaseModel):
    """Payload para edição de comentário pelo autor (PATCH /api/comments/{id})."""

    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


class CommentApproveIn(BaseModel):
    """Payload para moderação de comentário (PATCH /api/comments/admin/{id})."""

    action: Literal["approve", "reject"]
    note: Optional[str] = Field(default=None, max_length=1000)
