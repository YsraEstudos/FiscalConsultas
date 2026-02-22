"""Add subscriptions table for billing events

Revision ID: 004_add_subscriptions_table
Revises: 003_global_catalog_and_tenant_fk
Create Date: 2026-02-06
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "004_add_subscriptions_table"
down_revision = "003_global_catalog_and_tenant_fk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "tenant_id", sa.String(255), sa.ForeignKey("tenants.id"), nullable=False
        ),
        sa.Column("provider", sa.String(30), nullable=False, server_default="asaas"),
        sa.Column("provider_customer_id", sa.String(255), nullable=True),
        sa.Column("provider_subscription_id", sa.String(255), nullable=True),
        sa.Column("provider_payment_id", sa.String(255), nullable=True),
        sa.Column("plan_name", sa.String(64), nullable=False, server_default="pro"),
        sa.Column("status", sa.String(64), nullable=False, server_default="pending"),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("billing_cycle", sa.String(32), nullable=True),
        sa.Column("next_due_date", sa.Date(), nullable=True),
        sa.Column("last_payment_date", sa.DateTime(), nullable=True),
        sa.Column("last_event", sa.String(64), nullable=True),
        sa.Column("raw_payload", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
    )

    op.create_index("ix_subscriptions_tenant_id", "subscriptions", ["tenant_id"])
    op.create_index("ix_subscriptions_provider", "subscriptions", ["provider"])
    op.create_index(
        "ix_subscriptions_provider_customer_id",
        "subscriptions",
        ["provider_customer_id"],
    )
    op.create_index(
        "ix_subscriptions_provider_subscription_id",
        "subscriptions",
        ["provider_subscription_id"],
        unique=True,
    )
    op.create_index(
        "ix_subscriptions_provider_payment_id", "subscriptions", ["provider_payment_id"]
    )
    op.create_index("ix_subscriptions_status", "subscriptions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_subscriptions_status", table_name="subscriptions")
    op.drop_index("ix_subscriptions_provider_payment_id", table_name="subscriptions")
    op.drop_index(
        "ix_subscriptions_provider_subscription_id", table_name="subscriptions"
    )
    op.drop_index("ix_subscriptions_provider_customer_id", table_name="subscriptions")
    op.drop_index("ix_subscriptions_provider", table_name="subscriptions")
    op.drop_index("ix_subscriptions_tenant_id", table_name="subscriptions")
    op.drop_table("subscriptions")
