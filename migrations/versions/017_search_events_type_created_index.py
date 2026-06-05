"""Add dashboard search type/date index.

Revision ID: 017_search_events_type_created_index
Revises: 016_search_events_dashboard_indexes
"""

import sqlalchemy as sa
from alembic import op

revision = "017_search_events_type_created_index"
down_revision = "016_search_events_dashboard_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "search_events" not in inspector.get_table_names():
        return

    existing_indexes = {
        index_name
        for index in inspector.get_indexes("search_events")
        if isinstance(index_name := index["name"], str)
    }
    if "ix_search_events_created_type" not in existing_indexes:
        op.create_index(
            "ix_search_events_created_type",
            "search_events",
            ["created_at", "search_type"],
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "search_events" not in inspector.get_table_names():
        return

    has_created_type_index = any(
        index["name"] == "ix_search_events_created_type"
        for index in inspector.get_indexes("search_events")
    )
    if has_created_type_index:
        op.drop_index("ix_search_events_created_type", table_name="search_events")
