"""
Schemas Pydantic para a API de Comentários.

Separados do modelo ORM para controle explícito de serialização
e validação nas entradas/saídas da API.
"""

from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator

ANCHOR_KEY_PATTERN = r"^[A-Za-z0-9._:-]{1,255}$"
_MAX_HTML_TAG_SCAN = 512


def _contains_html_tag(value: str) -> bool:
    for index, char in enumerate(value):
        if char != "<":
            continue
        close_index = value.find(">", index + 1, index + _MAX_HTML_TAG_SCAN + 1)
        if close_index == -1:
            continue
        if "<" in value[index + 1 : close_index]:
            continue

        cursor = index + 1
        while cursor < close_index and value[cursor].isspace():
            cursor += 1
        if cursor < close_index and value[cursor] == "/":
            cursor += 1
        while cursor < close_index and value[cursor].isspace():
            cursor += 1
        if (
            cursor >= close_index
            or value[cursor] not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        ):
            continue

        cursor += 1
        while cursor < close_index:
            current = value[cursor]
            if current.isspace() or current in {">", "/"}:
                return True
            if not (
                current.isascii()
                and (current.isalnum() or current in {"-", ":", "_"})
            ):
                break
            cursor += 1
        else:
            return True
    return False


def _clean_plain_text(value: str, *, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field_name} não pode ficar vazio")
    if _contains_html_tag(cleaned):
        raise ValueError(f"{field_name} não aceita HTML")
    return cleaned


class CommentCreate(BaseModel):
    """Payload para criação de comentário (POST /api/comments/)."""

    anchor_key: str = Field(
        min_length=1,
        max_length=255,
        pattern=ANCHOR_KEY_PATTERN,
        description="ID do elemento âncora no HTML",
    )
    selected_text: str = Field(min_length=1, max_length=5000)
    body: str = Field(min_length=1, max_length=4000)
    is_private: bool = Field(
        default=False, description="True → status=private, False → status=pending"
    )
    model_config = {"extra": "forbid"}

    @field_validator("body", "selected_text")
    @classmethod
    def strip_whitespace(cls, v: str, info) -> str:
        return _clean_plain_text(v, field_name=info.field_name)


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
        return _clean_plain_text(v, field_name="body")

    model_config = {"extra": "forbid"}


class CommentApproveIn(BaseModel):
    """Payload para moderação de comentário (PATCH /api/comments/admin/{id})."""

    action: Literal["approve", "reject"]
    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("note")
    @classmethod
    def strip_note(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return _clean_plain_text(v, field_name="note")

    model_config = {"extra": "forbid"}
