"""Add description_normalized prefix index for NBS search performance.

Revision ID: 014_nbs_description_prefix_index
Revises: 013_search_resource_optimizations
Create Date: 2026-04-27
"""

import logging

from alembic import op

logger = logging.getLogger(__name__)

revision = "014_nbs_description_prefix_index"
down_revision = "013_search_resource_optimizations"
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

    _execute_concurrently(
        [
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "idx_nbs_items_desc_norm_prefix_public "
            "ON nbs_items (description_normalized text_pattern_ops) "
            "WHERE tenant_id IS NULL",
        ]
    )

    op.execute("ANALYZE nbs_items")


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    _execute_concurrently(
        [
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "idx_nbs_items_desc_norm_prefix_public",
        ]
    )
