"""Create search_events table for admin analytics dashboard.

Revision ID: 015
Revises: 014_subscriptions_timestamptz
"""

import sqlalchemy as sa
from alembic import op

revision = "015_search_events"
down_revision = "014_subscriptions_timestamptz"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "search_events",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("user_id", sa.String(255), nullable=True, index=True),
        sa.Column("user_email", sa.String(255), nullable=True),
        sa.Column("session_id", sa.String(255), nullable=True),
        sa.Column("device_fingerprint", sa.String(128), nullable=False, index=True),
        sa.Column("device_label", sa.String(255), nullable=True),
        sa.Column("search_type", sa.String(20), nullable=False),
        sa.Column("search_query", sa.String(300), nullable=True),
        sa.Column(
            "tenant_id",
            sa.String(),
            sa.ForeignKey("tenants.id"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            index=True,
        ),
    )

    # Composite indexes for dashboard queries
    op.create_index(
        "ix_search_events_user_created",
        "search_events",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_search_events_tenant_created",
        "search_events",
        ["tenant_id", "created_at"],
    )
    op.create_index(
        "ix_search_events_fp_created",
        "search_events",
        ["device_fingerprint", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_search_events_fp_created", table_name="search_events")
    op.drop_index("ix_search_events_tenant_created", table_name="search_events")
    op.drop_index("ix_search_events_user_created", table_name="search_events")
    op.drop_table("search_events")
