"""
Schemas Pydantic para a API de Perfil de Usuário.

Separados do modelo ORM para controle explícito de serialização
e validação nas entradas/saídas da API.
"""

from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field, field_validator


class UserProfileUpdate(BaseModel):
    """Payload para atualização de perfil (PATCH /api/profile/me)."""

    bio: Optional[str] = Field(default=None, max_length=500)

    @field_validator("bio")
    @classmethod
    def strip_whitespace(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            return v if v else None
        return None


class UserProfileResponse(BaseModel):
    """Resposta completa do perfil do usuário."""

    user_id: str
    email: str
    full_name: Optional[str] = None
    bio: Optional[str] = None
    image_url: Optional[str] = None
    tenant_id: str
    org_name: Optional[str] = None
    is_active: bool = True

    # Estatísticas de contribuições
    comment_count: int = 0
    pending_comment_count: int = 0
    approved_comment_count: int = 0


class UserCardResponse(BaseModel):
    """Mini-card para hover tooltip sobre nome de usuário."""

    user_id: str
    full_name: Optional[str] = None
    bio: Optional[str] = None
    image_url: Optional[str] = None
    comment_count: int = 0


class ContributionItem(BaseModel):
    """Item individual na lista de contribuições."""

    id: int
    type: str = "comment"  # "comment" por enquanto; extensível para "note"
    anchor_key: str
    selected_text: str
    body: str
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContributionsResponse(BaseModel):
    """Resposta paginada de contribuições do usuário."""

    items: List[ContributionItem]
    total: int
    page: int
    page_size: int
    has_next: bool
