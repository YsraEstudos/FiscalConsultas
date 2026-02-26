"""Convert comments timestamps to timestamptz.

Revision ID: 010_comments_timestamptz
Revises: 009_create_comments_table
Create Date: 2026-02-26
"""

from alembic import op
import sqlalchemy as sa

revision = "010_comments_timestamptz"
down_revision = "009_create_comments_table"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if not _table_exists("comments"):
        return

    # Existing values are interpreted as UTC before converting to timestamptz.
    op.execute(
        "ALTER TABLE comments "
        "ALTER COLUMN created_at TYPE TIMESTAMPTZ "
        "USING created_at AT TIME ZONE 'UTC'"
    )
    op.execute(
        "ALTER TABLE comments "
        "ALTER COLUMN updated_at TYPE TIMESTAMPTZ "
        "USING updated_at AT TIME ZONE 'UTC'"
    )
    op.execute(
        "ALTER TABLE comments "
        "ALTER COLUMN moderated_at TYPE TIMESTAMPTZ "
        "USING moderated_at AT TIME ZONE 'UTC'"
    )


def downgrade() -> None:
    if not _table_exists("comments"):
        return

    op.execute(
        "ALTER TABLE comments "
        "ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE "
        "USING created_at AT TIME ZONE 'UTC'"
    )
    op.execute(
        "ALTER TABLE comments "
        "ALTER COLUMN updated_at TYPE TIMESTAMP WITHOUT TIME ZONE "
        "USING updated_at AT TIME ZONE 'UTC'"
    )
    op.execute(
        "ALTER TABLE comments "
        "ALTER COLUMN moderated_at TYPE TIMESTAMP WITHOUT TIME ZONE "
        "USING moderated_at AT TIME ZONE 'UTC'"
    )
