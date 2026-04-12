"""Search resource optimization indexes and observability helpers.

Revision ID: 013_search_resource_optimizations
Revises: 012_services_catalog_postgres
Create Date: 2026-04-12
"""

from alembic import op
import sqlalchemy as sa

revision = "013_search_resource_optimizations"
down_revision = "012_services_catalog_postgres"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")

    # Keep one GIN index per search_vector and remove overlapping duplicates.
    op.execute("DROP INDEX IF EXISTS idx_chapters_fts")
    op.execute("DROP INDEX IF EXISTS idx_positions_fts")
    op.execute("DROP INDEX IF EXISTS idx_tipi_positions_fts")

    # Align ordering path for chapter position lookups.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_chapter_codigo "
        "ON positions (chapter_num, codigo)"
    )

    # Support the new branch-based catalog queries on the current public workload.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_nbs_items_code_clean_public "
        "ON nbs_items (code_clean) "
        "WHERE tenant_id IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_nebs_entries_code_clean_trusted_public "
        "ON nebs_entries (code_clean) "
        "WHERE parser_status = 'trusted' AND tenant_id IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_nebs_entries_title_prefix_trusted_public "
        "ON nebs_entries (title_normalized text_pattern_ops) "
        "WHERE parser_status = 'trusted' AND tenant_id IS NULL"
    )

    op.execute("ANALYZE chapters")
    op.execute("ANALYZE positions")
    op.execute("ANALYZE nbs_items")
    op.execute("ANALYZE nebs_entries")
    op.execute("ANALYZE tipi_positions")


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    op.execute("DROP INDEX IF EXISTS idx_nebs_entries_title_prefix_trusted_public")
    op.execute("DROP INDEX IF EXISTS idx_nebs_entries_code_clean_trusted_public")
    op.execute("DROP INDEX IF EXISTS idx_nbs_items_code_clean_public")
    op.execute("DROP INDEX IF EXISTS idx_positions_chapter_codigo")

    # Recreate previously duplicated FTS indexes only if downgrade is requested.
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
