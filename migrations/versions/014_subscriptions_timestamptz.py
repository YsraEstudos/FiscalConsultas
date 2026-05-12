"""Convert subscription timestamps to timestamptz.

Revision ID: 014_subscriptions_timestamptz
Revises: 013_search_resource_opts
Create Date: 2026-05-12
"""

from alembic import op

revision = "014_subscriptions_timestamptz"
down_revision = "013_search_resource_opts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    op.execute(
        "ALTER TABLE subscriptions "
        "ALTER COLUMN last_payment_date TYPE TIMESTAMPTZ "
        "USING last_payment_date AT TIME ZONE 'UTC'"
    )
    op.execute(
        "ALTER TABLE subscriptions "
        "ALTER COLUMN created_at TYPE TIMESTAMPTZ "
        "USING created_at AT TIME ZONE 'UTC'"
    )
    op.execute(
        "ALTER TABLE subscriptions "
        "ALTER COLUMN updated_at TYPE TIMESTAMPTZ "
        "USING updated_at AT TIME ZONE 'UTC'"
    )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    op.execute(
        "ALTER TABLE subscriptions "
        "ALTER COLUMN last_payment_date TYPE TIMESTAMP WITHOUT TIME ZONE "
        "USING last_payment_date AT TIME ZONE 'UTC'"
    )
    op.execute(
        "ALTER TABLE subscriptions "
        "ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE "
        "USING created_at AT TIME ZONE 'UTC'"
    )
    op.execute(
        "ALTER TABLE subscriptions "
        "ALTER COLUMN updated_at TYPE TIMESTAMP WITHOUT TIME ZONE "
        "USING updated_at AT TIME ZONE 'UTC'"
    )
