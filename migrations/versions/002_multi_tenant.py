"""Add multi-tenant support

Revision ID: 002_multi_tenant
Revises: 001_initial
Create Date: 2026-02-06

Adds tenants and users tables for multi-tenant architecture.
Adds tenant_id columns to existing tables.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "002_multi_tenant"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===== Tabela tenants =====
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(255), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
        sa.Column("subscription_plan", sa.String(50), nullable=False, default="free"),
    )

    # ===== Tabela users =====
    op.create_table(
        "users",
        sa.Column("id", sa.String(255), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column(
            "tenant_id", sa.String(255), sa.ForeignKey("tenants.id"), nullable=False
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])

    # ===== Adicionar tenant_id às tabelas existentes =====
    # Nota: tenant_id é nullable para manter compatibilidade com dados existentes
    op.add_column("chapters", sa.Column("tenant_id", sa.String(255), nullable=True))
    op.add_column("positions", sa.Column("tenant_id", sa.String(255), nullable=True))
    op.add_column(
        "chapter_notes", sa.Column("tenant_id", sa.String(255), nullable=True)
    )

    # Criar índices para tenant_id
    op.create_index("ix_chapters_tenant_id", "chapters", ["tenant_id"])
    op.create_index("ix_positions_tenant_id", "positions", ["tenant_id"])
    op.create_index("ix_chapter_notes_tenant_id", "chapter_notes", ["tenant_id"])


def downgrade() -> None:
    # Remover índices
    op.drop_index("ix_chapter_notes_tenant_id", table_name="chapter_notes")
    op.drop_index("ix_positions_tenant_id", table_name="positions")
    op.drop_index("ix_chapters_tenant_id", table_name="chapters")

    # Remover colunas tenant_id
    op.drop_column("chapter_notes", "tenant_id")
    op.drop_column("positions", "tenant_id")
    op.drop_column("chapters", "tenant_id")

    # Remover índices de users
    op.drop_index("ix_users_tenant_id", table_name="users")
    op.drop_index("ix_users_email", table_name="users")

    # Remover tabelas
    op.drop_table("users")
    op.drop_table("tenants")
