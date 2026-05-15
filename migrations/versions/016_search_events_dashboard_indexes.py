"""Add dashboard-friendly search event indexes.

Revision ID: 016_search_events_dashboard_indexes
Revises: 015_search_events
"""

import sqlalchemy as sa
from alembic import op

revision = "016_search_events_dashboard_indexes"
down_revision = "015_search_events"
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
    if "ix_search_events_created_fp" not in existing_indexes:
        op.create_index(
            "ix_search_events_created_fp",
            "search_events",
            ["created_at", "device_fingerprint"],
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "search_events" not in inspector.get_table_names():
        return

    has_created_fp_index = any(
        index["name"] == "ix_search_events_created_fp"
        for index in inspector.get_indexes("search_events")
    )
    if has_created_fp_index:
        op.drop_index("ix_search_events_created_fp", table_name="search_events")
