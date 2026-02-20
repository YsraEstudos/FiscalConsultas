"""Normalize shared catalog tenanting and enforce tenant foreign keys.

Revision ID: 003_global_catalog_and_tenant_fk
Revises: 002_multi_tenant
Create Date: 2026-02-06

This migration:
1) Converts legacy catalog rows from tenant_id='org_default' to tenant_id=NULL
   so fiscal reference data is shared across tenants.
2) Nullifies invalid tenant references in catalog tables.
3) Adds missing FK constraints from catalog tenant_id columns to tenants.id.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "003_global_catalog_and_tenant_fk"
down_revision = "002_multi_tenant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Normalize legacy seeded tenant to shared catalog (NULL tenant_id)
    op.execute("UPDATE chapters SET tenant_id = NULL WHERE tenant_id = 'org_default'")
    op.execute("UPDATE positions SET tenant_id = NULL WHERE tenant_id = 'org_default'")
    op.execute(
        "UPDATE chapter_notes SET tenant_id = NULL WHERE tenant_id = 'org_default'"
    )

    # 2) Guarantee referential consistency before adding FK constraints
    op.execute("""
        UPDATE chapters c
        SET tenant_id = NULL
        WHERE tenant_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = c.tenant_id)
    """)
    op.execute("""
        UPDATE positions p
        SET tenant_id = NULL
        WHERE tenant_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = p.tenant_id)
    """)
    op.execute("""
        UPDATE chapter_notes n
        SET tenant_id = NULL
        WHERE tenant_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = n.tenant_id)
    """)

    # 3) Add missing FK constraints for catalog tables
    op.create_foreign_key(
        "fk_chapters_tenant_id_tenants",
        "chapters",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_positions_tenant_id_tenants",
        "positions",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_chapter_notes_tenant_id_tenants",
        "chapter_notes",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # Drop FK constraints added in upgrade
    op.drop_constraint(
        "fk_chapter_notes_tenant_id_tenants", "chapter_notes", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_positions_tenant_id_tenants", "positions", type_="foreignkey"
    )
    op.drop_constraint("fk_chapters_tenant_id_tenants", "chapters", type_="foreignkey")
