"""Add bio text field to users table.

Revision ID: 011_add_user_bio
Revises: 010_comments_timestamptz
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa

revision = "011_add_user_bio"
down_revision = "010_comments_timestamptz"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "users" not in inspector.get_table_names():
        return  # Table created elsewhere; bio column will be included at creation time
    existing_cols = {c["name"] for c in inspector.get_columns("users")}
    if "bio" not in existing_cols:
        op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "users" not in inspector.get_table_names():
        return
    existing_cols = {c["name"] for c in inspector.get_columns("users")}
    if "bio" in existing_cols:
        op.drop_column("users", "bio")
