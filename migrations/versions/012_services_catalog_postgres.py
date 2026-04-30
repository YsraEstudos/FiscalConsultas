"""Create PostgreSQL runtime tables for NBS / NEBS catalogs.

Revision ID: 012_services_catalog_postgres
Revises: 011_add_user_bio
Create Date: 2026-03-25
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "012_services_catalog_postgres"
down_revision = "011_add_user_bio"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    is_postgres = conn.dialect.name == "postgresql"
    existing_tables = set(inspector.get_table_names())

    if "catalog_metadata" not in existing_tables:
        op.create_table(
            "catalog_metadata",
            sa.Column("key", sa.String(length=255), primary_key=True),
            sa.Column("value", sa.Text(), nullable=False),
            sa.Column(
                "tenant_id",
                sa.String(length=64),
                sa.ForeignKey("tenants.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_catalog_metadata_tenant_id",
            "catalog_metadata",
            ["tenant_id"],
            unique=False,
        )

    if "nbs_items" not in existing_tables:
        columns = [
            sa.Column("code", sa.String(length=64), primary_key=True),
            sa.Column("code_clean", sa.String(length=64), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("description_normalized", sa.Text(), nullable=False),
            sa.Column("parent_code", sa.String(length=64), nullable=True),
            sa.Column("level", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("source_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("sort_path", sa.String(length=255), nullable=False),
            sa.Column(
                "has_nebs", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            sa.Column(
                "tenant_id",
                sa.String(length=64),
                sa.ForeignKey("tenants.id", ondelete="SET NULL"),
                nullable=True,
            ),
        ]
        if is_postgres:
            columns.append(sa.Column("search_vector", postgresql.TSVECTOR()))
        else:
            columns.append(sa.Column("search_vector", sa.Text(), nullable=True))

        op.create_table(
            "nbs_items",
            *columns,
            sa.ForeignKeyConstraint(["parent_code"], ["nbs_items.code"]),
        )
        op.create_index("ix_nbs_items_code_clean", "nbs_items", ["code_clean"])
        op.create_index("ix_nbs_items_sort_path", "nbs_items", ["sort_path"])
        op.create_index("ix_nbs_items_source_order", "nbs_items", ["source_order"])
        op.create_index("ix_nbs_items_tenant_id", "nbs_items", ["tenant_id"])
        op.create_index(
            "ix_nbs_items_parent_source",
            "nbs_items",
            ["parent_code", "source_order"],
        )

    if "nebs_entries" not in existing_tables:
        columns = [
            sa.Column("code", sa.String(length=64), primary_key=True),
            sa.Column("code_clean", sa.String(length=64), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("title_normalized", sa.Text(), nullable=False),
            sa.Column("body_text", sa.Text(), nullable=False),
            sa.Column("body_markdown", sa.Text(), nullable=True),
            sa.Column("body_normalized", sa.Text(), nullable=False),
            sa.Column("section_title", sa.Text(), nullable=True),
            sa.Column("page_start", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("page_end", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("parser_status", sa.String(length=32), nullable=False),
            sa.Column("parse_warnings", sa.Text(), nullable=True),
            sa.Column("source_hash", sa.String(length=128), nullable=False),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column(
                "tenant_id",
                sa.String(length=64),
                sa.ForeignKey("tenants.id", ondelete="SET NULL"),
                nullable=True,
            ),
        ]
        if is_postgres:
            columns.append(sa.Column("search_vector", postgresql.TSVECTOR()))
        else:
            columns.append(sa.Column("search_vector", sa.Text(), nullable=True))

        op.create_table(
            "nebs_entries",
            *columns,
            sa.ForeignKeyConstraint(["code"], ["nbs_items.code"]),
        )
        op.create_index("ix_nebs_entries_code_clean", "nebs_entries", ["code_clean"])
        op.create_index(
            "ix_nebs_entries_parser_status", "nebs_entries", ["parser_status"]
        )
        op.create_index("ix_nebs_entries_tenant_id", "nebs_entries", ["tenant_id"])
        op.create_index(
            "ix_nebs_entries_status_code",
            "nebs_entries",
            ["parser_status", "code"],
        )
        op.create_index("ix_nebs_entries_updated_at", "nebs_entries", ["updated_at"])

    if is_postgres:
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_nbs_items_fts "
            "ON nbs_items USING GIN(search_vector)"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_nebs_entries_fts "
            "ON nebs_entries USING GIN(search_vector)"
        )
        op.execute(
            "CREATE OR REPLACE FUNCTION update_nbs_item_search_vector() "
            "RETURNS trigger AS $$ "
            "BEGIN "
            "  NEW.search_vector := to_tsvector('portuguese', COALESCE(NEW.description, '')); "
            "  RETURN NEW; "
            "END "
            "$$ LANGUAGE plpgsql"
        )
        op.execute("DROP TRIGGER IF EXISTS nbs_items_search_update ON nbs_items")
        op.execute(
            "CREATE TRIGGER nbs_items_search_update "
            "BEFORE INSERT OR UPDATE ON nbs_items "
            "FOR EACH ROW EXECUTE FUNCTION update_nbs_item_search_vector()"
        )
        op.execute(
            "CREATE OR REPLACE FUNCTION update_nebs_entry_search_vector() "
            "RETURNS trigger AS $$ "
            "BEGIN "
            "  NEW.search_vector := to_tsvector('portuguese', "
            "    trim(COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.section_title, '') || ' ' || COALESCE(NEW.body_text, ''))"
            "  ); "
            "  RETURN NEW; "
            "END "
            "$$ LANGUAGE plpgsql"
        )
        op.execute("DROP TRIGGER IF EXISTS nebs_entries_search_update ON nebs_entries")
        op.execute(
            "CREATE TRIGGER nebs_entries_search_update "
            "BEFORE INSERT OR UPDATE ON nebs_entries "
            "FOR EACH ROW EXECUTE FUNCTION update_nebs_entry_search_vector()"
        )


def downgrade() -> None:
    conn = op.get_bind()
    is_postgres = conn.dialect.name == "postgresql"

    if is_postgres:
        op.execute("DROP TRIGGER IF EXISTS nebs_entries_search_update ON nebs_entries")
        op.execute("DROP TRIGGER IF EXISTS nbs_items_search_update ON nbs_items")
        op.execute("DROP FUNCTION IF EXISTS update_nebs_entry_search_vector()")
        op.execute("DROP FUNCTION IF EXISTS update_nbs_item_search_vector()")
        op.execute("DROP INDEX IF EXISTS idx_nebs_entries_fts")
        op.execute("DROP INDEX IF EXISTS idx_nbs_items_fts")

    if "nebs_entries" in sa.inspect(conn).get_table_names():
        op.drop_index("ix_nebs_entries_updated_at", table_name="nebs_entries")
        op.drop_index("ix_nebs_entries_status_code", table_name="nebs_entries")
        op.drop_index("ix_nebs_entries_tenant_id", table_name="nebs_entries")
        op.drop_index("ix_nebs_entries_parser_status", table_name="nebs_entries")
        op.drop_index("ix_nebs_entries_code_clean", table_name="nebs_entries")
        op.drop_table("nebs_entries")

    if "nbs_items" in sa.inspect(conn).get_table_names():
        op.drop_index("ix_nbs_items_parent_source", table_name="nbs_items")
        op.drop_index("ix_nbs_items_tenant_id", table_name="nbs_items")
        op.drop_index("ix_nbs_items_source_order", table_name="nbs_items")
        op.drop_index("ix_nbs_items_sort_path", table_name="nbs_items")
        op.drop_index("ix_nbs_items_code_clean", table_name="nbs_items")
        op.drop_table("nbs_items")

    if "catalog_metadata" in sa.inspect(conn).get_table_names():
        op.drop_index("ix_catalog_metadata_tenant_id", table_name="catalog_metadata")
        op.drop_table("catalog_metadata")
