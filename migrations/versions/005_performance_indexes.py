"""Add B-tree indexes for FK columns (performance)

Revision ID: 005_performance_indexes
Revises: 004_add_subscriptions_table
Create Date: 2026-02-06

These indexes are CRITICAL for performance after PostgreSQL migration.
SQLite had implicit indexes from scripts/setup_database.py (idx_position_chapter)
but they were never replicated in the Alembic migrations.

Without these indexes, every selectinload/joinedload for positions and notes
does a sequential scan on tables with thousands of rows, turning <1ms SQLite
queries into 100ms+ PostgreSQL queries.
"""

from alembic import op

# revision identifiers
revision = "005_performance_indexes"
down_revision = "004_add_subscriptions_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    is_postgres = conn.dialect.name == "postgresql"

    # ===== B-tree indexes on FK columns =====
    # These are essential for JOIN/WHERE performance on chapter lookups

    # positions.chapter_num - used by every chapter load (selectinload/joinedload)
    op.create_index(
        "idx_positions_chapter_num",
        "positions",
        ["chapter_num"],
    )

    # chapter_notes.chapter_num - used by every chapter load
    op.create_index(
        "idx_chapter_notes_chapter_num",
        "chapter_notes",
        ["chapter_num"],
    )

    # tipi_positions.chapter_num - used by every TIPI chapter query
    op.create_index(
        "idx_tipi_positions_chapter_num",
        "tipi_positions",
        ["chapter_num"],
    )

    if is_postgres:
        # ===== Composite indexes for common query patterns =====

        # positions: chapter_num + codigo (covers ORDER BY codigo within chapter)
        op.create_index(
            "idx_positions_chapter_codigo",
            "positions",
            ["chapter_num", "codigo"],
        )

        # tipi_positions: chapter_num + codigo (covers ORDER BY codigo within chapter)
        op.create_index(
            "idx_tipi_positions_chapter_codigo",
            "tipi_positions",
            ["chapter_num", "codigo"],
        )

        # ===== Partial indexes for RLS optimization =====
        # These help queries WHERE tenant_id IS NULL (public catalog data)
        # Skip if tenant_id column doesn't exist yet
        try:
            op.create_index(
                "idx_chapters_public",
                "chapters",
                ["chapter_num"],
                postgresql_where="tenant_id IS NULL",
            )
            op.create_index(
                "idx_positions_public",
                "positions",
                ["chapter_num"],
                postgresql_where="tenant_id IS NULL",
            )
        except Exception:
            # tenant_id column may not exist in all environments
            pass

        # ===== ANALYZE tables to update query planner statistics =====
        op.execute("ANALYZE chapters")
        op.execute("ANALYZE positions")
        op.execute("ANALYZE chapter_notes")
        op.execute("ANALYZE tipi_positions")


def downgrade() -> None:
    # Remove composite/partial indexes first (PostgreSQL only)
    try:
        op.drop_index("idx_chapters_public", table_name="chapters")
    except Exception:
        pass
    try:
        op.drop_index("idx_positions_public", table_name="positions")
    except Exception:
        pass
    try:
        op.drop_index("idx_tipi_positions_chapter_codigo", table_name="tipi_positions")
    except Exception:
        pass
    try:
        op.drop_index("idx_positions_chapter_codigo", table_name="positions")
    except Exception:
        pass

    # Remove FK indexes
    op.drop_index("idx_tipi_positions_chapter_num", table_name="tipi_positions")
    op.drop_index("idx_chapter_notes_chapter_num", table_name="chapter_notes")
    op.drop_index("idx_positions_chapter_num", table_name="positions")
