"""Search resource optimization indexes and observability helpers.

Revision ID: 013_search_resource_optimizations
Revises: 012_services_catalog_postgres
Create Date: 2026-04-12
"""

from alembic import op

revision = "013_search_resource_optimizations"
down_revision = "012_services_catalog_postgres"
branch_labels = None
depends_on = None


def _execute_concurrently(statements: list[str]) -> None:
    context = op.get_context()
    with context.autocommit_block():
        for statement in statements:
            op.execute(statement)


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")

    # Keep one GIN index per search_vector and remove overlapping duplicates.
    _execute_concurrently(
        [
            "DROP INDEX CONCURRENTLY IF EXISTS idx_chapters_fts",
            "DROP INDEX CONCURRENTLY IF EXISTS idx_positions_fts",
            "DROP INDEX CONCURRENTLY IF EXISTS idx_tipi_positions_fts",
        ]
    )

    # Align ordering path for chapter position lookups.
    _execute_concurrently(
        [
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_chapter_codigo "
            "ON positions (chapter_num, codigo)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nbs_items_code_clean_public "
            "ON nbs_items (code_clean) "
            "WHERE tenant_id IS NULL",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nebs_entries_code_clean_trusted_public "
            "ON nebs_entries (code_clean) "
            "WHERE parser_status = 'trusted' AND tenant_id IS NULL",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nebs_entries_title_prefix_trusted_public "
            "ON nebs_entries (title_normalized text_pattern_ops) "
            "WHERE parser_status = 'trusted' AND tenant_id IS NULL",
        ]
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

    _execute_concurrently(
        [
            "DROP INDEX CONCURRENTLY IF EXISTS idx_nebs_entries_title_prefix_trusted_public",
            "DROP INDEX CONCURRENTLY IF EXISTS idx_nebs_entries_code_clean_trusted_public",
            "DROP INDEX CONCURRENTLY IF EXISTS idx_nbs_items_code_clean_public",
            "DROP INDEX CONCURRENTLY IF EXISTS idx_positions_chapter_codigo",
        ]
    )

    # Recreate previously duplicated FTS indexes only if downgrade is requested.
    _execute_concurrently(
        [
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chapters_fts "
            "ON chapters USING GIN(search_vector)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_fts "
            "ON positions USING GIN(search_vector)",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tipi_positions_fts "
            "ON tipi_positions USING GIN(search_vector)",
        ]
    )
