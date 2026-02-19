"""Add user_name and user_image_url to comments

Revision ID: 008_add_comment_profile_fields
Revises: 007_tipi_hierarchy_columns
Create Date: 2025-07-11
"""

from alembic import op
import sqlalchemy as sa

revision = "008_add_comment_profile_fields"
down_revision = "007_tipi_hierarchy_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Guard: table may not exist yet (009 creates it with these columns already included)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "comments" not in inspector.get_table_names():
        return  # 009_create_comments_table will create the table with these columns
    existing_cols = {c["name"] for c in inspector.get_columns("comments")}
    if "user_name" not in existing_cols:
        op.add_column(
            "comments", sa.Column("user_name", sa.String(length=255), nullable=True)
        )
    if "user_image_url" not in existing_cols:
        op.add_column(
            "comments",
            sa.Column("user_image_url", sa.String(length=1024), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("comments", "user_image_url")
    op.drop_column("comments", "user_name")
