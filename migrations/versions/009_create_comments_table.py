"""Create comments table (if not exists) and ensure all columns

Revision ID: 009_create_comments_table
Revises: 008_add_comment_profile_fields
Create Date: 2026-02-19

Note: The table may already exist via SQLModel create_all (SQLite dev mode).
This migration ensures it exists for Postgres deployments managed by Alembic,
and adds any columns that may be missing (e.g. moderation_note).
"""

from alembic import op
import sqlalchemy as sa

revision = "009_create_comments_table"
down_revision = "008_add_comment_profile_fields"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    """Check if table already exists in the database."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    return table_name in inspector.get_table_names()


def _column_exists(table_name: str, column_name: str) -> bool:
    """Check if column already exists in a table."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c["name"] for c in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    if not _table_exists("comments"):
        op.create_table(
            "comments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("tenant_id", sa.String(length=255), nullable=False, index=True),
            sa.Column("user_id", sa.String(length=255), nullable=False, index=True),
            sa.Column("anchor_key", sa.String(length=255), nullable=False, index=True),
            sa.Column("selected_text", sa.Text(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("user_name", sa.String(length=255), nullable=True),
            sa.Column("user_image_url", sa.String(length=1024), nullable=True),
            sa.Column(
                "status",
                sa.String(length=20),
                nullable=False,
                server_default="pending",
                index=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("moderated_by", sa.String(length=255), nullable=True),
            sa.Column("moderated_at", sa.DateTime(), nullable=True),
            sa.Column("moderation_note", sa.Text(), nullable=True),
        )

    # Ensure moderation_note column exists (may be missing if table was created
    # by an older version of create_all before the field was added to the model)
    if _table_exists("comments") and not _column_exists("comments", "moderation_note"):
        op.add_column(
            "comments", sa.Column("moderation_note", sa.Text(), nullable=True)
        )


def downgrade() -> None:
    op.drop_table("comments")
