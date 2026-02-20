"""Add precomputed columns (anchor_id, parsed_notes_json) and GIN indexes

Revision ID: 006_precomputed_columns_and_gin
Revises: 005_performance_indexes
Create Date: 2026-02-08

Adds:
- positions.anchor_id   — precomputed HTML anchor id, avoids runtime SHA on every fetch
- chapter_notes.parsed_notes_json — precomputed parsed notes dict, avoids runtime regex
- GIN indexes on tsvector columns (PostgreSQL only) for sub-ms FTS
"""

from alembic import op
import sqlalchemy as sa

revision = "006_precomputed_columns_and_gin"
down_revision = "005_performance_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    is_postgres = conn.dialect.name == "postgresql"

    # --- New precomputed columns ---
    op.add_column("positions", sa.Column("anchor_id", sa.String(40), nullable=True))
    op.add_column(
        "chapter_notes", sa.Column("parsed_notes_json", sa.Text(), nullable=True)
    )

    # --- Backfill anchor_id for existing rows ---
    # anchor_id = 'pos-' + replace('.', '-', codigo)
    if is_postgres:
        op.execute(
            "UPDATE positions SET anchor_id = 'pos-' || REPLACE(codigo, '.', '-') "
            "WHERE anchor_id IS NULL"
        )
    else:
        op.execute(
            "UPDATE positions SET anchor_id = 'pos-' || REPLACE(codigo, '.', '-') "
            "WHERE anchor_id IS NULL"
        )

    # --- GIN indexes on tsvector columns (PostgreSQL only) ---
    if is_postgres:
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_chapters_fts "
            "ON chapters USING GIN(search_vector)"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_positions_fts "
            "ON positions USING GIN(search_vector)"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_tipi_positions_fts "
            "ON tipi_positions USING GIN(search_vector)"
        )
        op.execute("ANALYZE chapters")
        op.execute("ANALYZE positions")
        op.execute("ANALYZE tipi_positions")


def downgrade() -> None:
    conn = op.get_bind()
    is_postgres = conn.dialect.name == "postgresql"

    if is_postgres:
        try:
            op.drop_index("idx_tipi_positions_fts", table_name="tipi_positions")
        except Exception:
            pass
        try:
            op.drop_index("idx_positions_fts", table_name="positions")
        except Exception:
            pass
        try:
            op.drop_index("idx_chapters_fts", table_name="chapters")
        except Exception:
            pass

    op.drop_column("chapter_notes", "parsed_notes_json")
    op.drop_column("positions", "anchor_id")
