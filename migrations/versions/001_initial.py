"""Initial PostgreSQL schema with FTS

Revision ID: 001_initial
Revises:
Create Date: 2026-02-06

Creates all tables from SQLModel models and sets up
PostgreSQL Full-Text Search with tsvector and triggers.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Detectar se é PostgreSQL
    conn = op.get_bind()
    is_postgres = conn.dialect.name == "postgresql"

    if is_postgres:
        # Habilitar extensão para busca textual avançada
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # ===== Tabela chapters =====
    if is_postgres:
        op.create_table(
            "chapters",
            sa.Column("chapter_num", sa.String(10), primary_key=True),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("raw_text", sa.Text(), nullable=True),
            sa.Column("search_vector", postgresql.TSVECTOR(), nullable=True),
        )
    else:
        op.create_table(
            "chapters",
            sa.Column("chapter_num", sa.String(10), primary_key=True),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("raw_text", sa.Text(), nullable=True),
        )

    # ===== Tabela positions =====
    if is_postgres:
        op.create_table(
            "positions",
            sa.Column("codigo", sa.String(20), primary_key=True),
            sa.Column("descricao", sa.Text(), nullable=False),
            sa.Column(
                "chapter_num",
                sa.String(10),
                sa.ForeignKey("chapters.chapter_num"),
                nullable=False,
            ),
            sa.Column("search_vector", postgresql.TSVECTOR(), nullable=True),
        )
    else:
        op.create_table(
            "positions",
            sa.Column("codigo", sa.String(20), primary_key=True),
            sa.Column("descricao", sa.Text(), nullable=False),
            sa.Column(
                "chapter_num",
                sa.String(10),
                sa.ForeignKey("chapters.chapter_num"),
                nullable=False,
            ),
        )

    # ===== Tabela chapter_notes =====
    op.create_table(
        "chapter_notes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "chapter_num",
            sa.String(10),
            sa.ForeignKey("chapters.chapter_num"),
            unique=True,
            nullable=False,
        ),
        sa.Column("notes_content", sa.Text(), nullable=True),
        sa.Column("titulo", sa.Text(), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("consideracoes", sa.Text(), nullable=True),
        sa.Column("definicoes", sa.Text(), nullable=True),
    )

    # ===== Tabela glossary =====
    op.create_table(
        "glossary",
        sa.Column("term", sa.String(255), primary_key=True),
        sa.Column("definition", sa.Text(), nullable=False),
    )

    # ===== Tabela tipi_positions =====
    if is_postgres:
        op.create_table(
            "tipi_positions",
            sa.Column("codigo", sa.String(20), primary_key=True),
            sa.Column("descricao", sa.Text(), nullable=False),
            sa.Column("aliquota", sa.String(20), nullable=True),
            sa.Column("chapter_num", sa.String(10), nullable=False),
            sa.Column("search_vector", postgresql.TSVECTOR(), nullable=True),
        )
    else:
        op.create_table(
            "tipi_positions",
            sa.Column("codigo", sa.String(20), primary_key=True),
            sa.Column("descricao", sa.Text(), nullable=False),
            sa.Column("aliquota", sa.String(20), nullable=True),
            sa.Column("chapter_num", sa.String(10), nullable=False),
        )

    # ===== Índices GIN para PostgreSQL FTS =====
    if is_postgres:
        op.create_index(
            "idx_chapters_search", "chapters", ["search_vector"], postgresql_using="gin"
        )
        op.create_index(
            "idx_positions_search",
            "positions",
            ["search_vector"],
            postgresql_using="gin",
        )
        op.create_index(
            "idx_tipi_positions_search",
            "tipi_positions",
            ["search_vector"],
            postgresql_using="gin",
        )

        # ===== Triggers para atualização automática de search_vector =====

        # Trigger função para chapters
        op.execute("""
            CREATE OR REPLACE FUNCTION update_chapter_search_vector()
            RETURNS trigger AS $$
            BEGIN
                NEW.search_vector := to_tsvector('portuguese', COALESCE(NEW.content, ''));
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql;
        """)

        op.execute("""
            CREATE TRIGGER chapters_search_update
            BEFORE INSERT OR UPDATE ON chapters
            FOR EACH ROW EXECUTE FUNCTION update_chapter_search_vector();
        """)

        # Trigger função para positions
        op.execute("""
            CREATE OR REPLACE FUNCTION update_position_search_vector()
            RETURNS trigger AS $$
            BEGIN
                NEW.search_vector := to_tsvector('portuguese', COALESCE(NEW.descricao, ''));
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql;
        """)

        op.execute("""
            CREATE TRIGGER positions_search_update
            BEFORE INSERT OR UPDATE ON positions
            FOR EACH ROW EXECUTE FUNCTION update_position_search_vector();
        """)

        # Trigger para tipi_positions
        op.execute("""
            CREATE TRIGGER tipi_positions_search_update
            BEFORE INSERT OR UPDATE ON tipi_positions
            FOR EACH ROW EXECUTE FUNCTION update_position_search_vector();
        """)


def downgrade() -> None:
    conn = op.get_bind()
    is_postgres = conn.dialect.name == "postgresql"

    if is_postgres:
        # Remover triggers
        op.execute("DROP TRIGGER IF EXISTS chapters_search_update ON chapters")
        op.execute("DROP TRIGGER IF EXISTS positions_search_update ON positions")
        op.execute(
            "DROP TRIGGER IF EXISTS tipi_positions_search_update ON tipi_positions"
        )
        op.execute("DROP FUNCTION IF EXISTS update_chapter_search_vector()")
        op.execute("DROP FUNCTION IF EXISTS update_position_search_vector()")

        # Remover índices
        op.drop_index("idx_chapters_search", table_name="chapters")
        op.drop_index("idx_positions_search", table_name="positions")
        op.drop_index("idx_tipi_positions_search", table_name="tipi_positions")

    # Remover tabelas
    op.drop_table("tipi_positions")
    op.drop_table("glossary")
    op.drop_table("chapter_notes")
    op.drop_table("positions")
    op.drop_table("chapters")
