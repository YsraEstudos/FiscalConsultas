"""Bridge legacy Render revision before search_events.

Revision ID: b57dd7119b90
Revises: 014_subscriptions_timestamptz
"""

revision = "b57dd7119b90"
down_revision = "014_subscriptions_timestamptz"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Keep databases stamped with this legacy revision on the main chain."""


def downgrade() -> None:
    """No schema changes were associated with this marker revision."""
