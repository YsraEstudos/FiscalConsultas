"""
Modelos SQLModel unificados para o Nesh/Fiscal.

Cada modelo serve simultaneamente como:
- Tabela do banco de dados (ORM)
- Schema Pydantic para validação e serialização (API)

Este módulo coexiste com models.py (TypedDict) para migração gradual.
"""

from datetime import date, datetime
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import TSVECTOR


# ============================================================
# Core Multi-Tenant Models
# ============================================================


class Tenant(SQLModel, table=True):
    """Representa uma Organização ou Cliente B2B (Mapeado do Clerk org_id)."""

    __tablename__ = "tenants"

    id: str = Field(
        primary_key=True, description="ID da organização (ex: Clerk org_id)"
    )
    name: str = Field(max_length=255)
    is_active: bool = Field(default=True)
    subscription_plan: str = Field(default="free")  # free, pro, enterprise

    # Relationships
    users: List["User"] = Relationship(back_populates="tenant")
    subscriptions: List["Subscription"] = Relationship(back_populates="tenant")


class User(SQLModel, table=True):
    """Usuário do sistema (Mapeado do Clerk user_id)."""

    __tablename__ = "users"

    id: str = Field(primary_key=True, description="ID do usuário (ex: Clerk user_id)")
    email: str = Field(unique=True, index=True, max_length=255)
    full_name: Optional[str] = Field(default=None, max_length=255)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    is_active: bool = Field(default=True)

    # Relationships
    tenant: Tenant = Relationship(back_populates="users")


class Subscription(SQLModel, table=True):
    """Assinatura do tenant (evento de billing/webhook)."""

    __tablename__ = "subscriptions"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: str = Field(foreign_key="tenants.id", index=True)
    provider: str = Field(default="asaas", max_length=30, index=True)
    provider_customer_id: Optional[str] = Field(
        default=None, max_length=255, index=True
    )
    provider_subscription_id: Optional[str] = Field(
        default=None, max_length=255, index=True, unique=True
    )
    provider_payment_id: Optional[str] = Field(default=None, max_length=255, index=True)
    plan_name: str = Field(default="pro", max_length=64)
    status: str = Field(default="pending", max_length=64, index=True)
    amount: Optional[float] = Field(default=None)
    billing_cycle: Optional[str] = Field(default=None, max_length=32)
    next_due_date: Optional[date] = Field(default=None)
    last_payment_date: Optional[datetime] = Field(default=None)
    last_event: Optional[str] = Field(default=None, max_length=64)
    raw_payload: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    tenant: Tenant = Relationship(back_populates="subscriptions")


# ============================================================
# Base Models (schemas de API sem table=True)
# ============================================================


class ChapterBase(SQLModel):
    """Schema base para Chapter - usado em criação/atualização."""

    chapter_num: str = Field(
        max_length=10, description="Número do capítulo (ex: 01, 85)"
    )
    content: str = Field(
        sa_column=Column(Text), description="Conteúdo textual completo"
    )
    raw_text: Optional[str] = Field(default=None, sa_column=Column(Text))


class PositionBase(SQLModel):
    """Schema base para Position - posição NCM."""

    codigo: str = Field(
        max_length=20, description="Código NCM formatado (ex: 8517.12.31)"
    )
    descricao: str = Field(sa_column=Column(Text), description="Descrição da posição")


class GlossaryBase(SQLModel):
    """Schema base para Glossary - termos técnicos."""

    term: str = Field(max_length=255, description="Termo técnico")
    definition: str = Field(sa_column=Column(Text), description="Definição do termo")


# ============================================================
# Table Models (ORM com table=True)
# ============================================================


class Chapter(ChapterBase, table=True):
    """Tabela de capítulos NESH."""

    __tablename__ = "chapters"

    chapter_num: str = Field(primary_key=True, max_length=10)
    tenant_id: Optional[str] = Field(default=None, foreign_key="tenants.id", index=True)

    # PostgreSQL FTS - tsvector para busca textual
    # Ignorado no SQLite (coluna será None)
    search_vector: Optional[str] = Field(
        default=None, sa_column=Column(TSVECTOR, nullable=True)
    )

    # Relationships
    notes: Optional["ChapterNotes"] = Relationship(back_populates="chapter")
    positions: List["Position"] = Relationship(back_populates="chapter")


class Position(PositionBase, table=True):
    """Tabela de posições NCM."""

    __tablename__ = "positions"

    codigo: str = Field(primary_key=True, max_length=20)
    chapter_num: str = Field(foreign_key="chapters.chapter_num", max_length=10)
    tenant_id: Optional[str] = Field(default=None, foreign_key="tenants.id", index=True)
    anchor_id: Optional[str] = Field(
        default=None, max_length=40, description="Precomputed HTML anchor id"
    )

    search_vector: Optional[str] = Field(
        default=None, sa_column=Column(TSVECTOR, nullable=True)
    )

    chapter: Optional[Chapter] = Relationship(back_populates="positions")


class ChapterNotes(SQLModel, table=True):
    """Notas e seções estruturadas de cada capítulo."""

    __tablename__ = "chapter_notes"

    id: Optional[int] = Field(default=None, primary_key=True)
    chapter_num: str = Field(
        foreign_key="chapters.chapter_num", unique=True, max_length=10
    )
    tenant_id: Optional[str] = Field(default=None, foreign_key="tenants.id", index=True)
    notes_content: Optional[str] = Field(default=None, sa_column=Column(Text))
    titulo: Optional[str] = Field(default=None, sa_column=Column(Text))
    notas: Optional[str] = Field(default=None, sa_column=Column(Text))
    consideracoes: Optional[str] = Field(default=None, sa_column=Column(Text))
    definicoes: Optional[str] = Field(default=None, sa_column=Column(Text))
    parsed_notes_json: Optional[str] = Field(
        default=None,
        sa_column=Column(Text),
        description="Precomputed parsed notes as JSON",
    )

    chapter: Optional[Chapter] = Relationship(back_populates="notes")


class Glossary(GlossaryBase, table=True):
    """Glossário de termos técnicos fiscais."""

    __tablename__ = "glossary"

    term: str = Field(primary_key=True, max_length=255)


# ============================================================
# TIPI Models (banco separado tipi.db)
# ============================================================


class TipiPosition(SQLModel, table=True):
    """Posição NCM na tabela TIPI (alíquotas IPI)."""

    __tablename__ = "tipi_positions"

    codigo: str = Field(primary_key=True, max_length=20)
    descricao: str = Field(sa_column=Column(Text))
    aliquota: Optional[str] = Field(default=None, max_length=20)
    chapter_num: str = Field(max_length=10)
    nivel: Optional[int] = Field(default=None)
    parent_ncm: Optional[str] = Field(default=None, max_length=20)
    ncm_sort: Optional[str] = Field(default=None, max_length=32)

    search_vector: Optional[str] = Field(
        default=None, sa_column=Column(TSVECTOR, nullable=True)
    )


# ============================================================
# Response Models (para API - sem table=True)
# ============================================================


class PositionRead(SQLModel):
    """Response model para posição com anchor_id."""

    codigo: str
    descricao: str
    anchor_id: Optional[str] = None  # Calculado no service


class ChapterNotesRead(SQLModel):
    """Response model para notas de capítulo."""

    notes_content: Optional[str] = None
    titulo: Optional[str] = None
    notas: Optional[str] = None
    consideracoes: Optional[str] = None
    definicoes: Optional[str] = None


class ChapterRead(SQLModel):
    """Response model completo para capítulo."""

    chapter_num: str
    content: str
    positions: List[PositionRead] = []
    notes: Optional[ChapterNotesRead] = None


class SearchResultItem(SQLModel):
    """Item individual de resultado de busca FTS."""

    ncm: str
    display_text: str
    type: str = "position"
    description: str
    score: float = 0.0
    tier: int = 1


class FTSSearchResponse(SQLModel):
    """Response model para busca Full-Text Search."""

    success: bool = True
    type: str = "text"
    query: str
    normalized: Optional[str] = None
    results: List[SearchResultItem] = []
    total: int = 0
    match_type: Optional[str] = None
    warning: Optional[str] = None


class CodeSearchResponse(SQLModel):
    """Response model para busca por código NCM."""

    success: bool = True
    type: str = "code"
    query: str
    chapters: List[ChapterRead] = []
    total_capitulos: int = 0
