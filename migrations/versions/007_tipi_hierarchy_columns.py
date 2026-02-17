"""Add TIPI hierarchy columns

Revision ID: 007_tipi_hierarchy_columns
Revises: 006_precomputed_columns_and_gin
Create Date: 2026-02-08
"""
from alembic import op
import sqlalchemy as sa

revision = '007_tipi_hierarchy_columns'
down_revision = '006_precomputed_columns_and_gin'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tipi_positions', sa.Column('nivel', sa.Integer(), nullable=True))
    op.add_column('tipi_positions', sa.Column('parent_ncm', sa.String(length=20), nullable=True))
    op.add_column('tipi_positions', sa.Column('ncm_sort', sa.String(length=32), nullable=True))

    op.create_index('idx_tipi_positions_ncm_sort', 'tipi_positions', ['ncm_sort'])
    op.create_index('idx_tipi_positions_parent_ncm', 'tipi_positions', ['parent_ncm'])


def downgrade() -> None:
    op.drop_index('idx_tipi_positions_parent_ncm', table_name='tipi_positions')
    op.drop_index('idx_tipi_positions_ncm_sort', table_name='tipi_positions')

    op.drop_column('tipi_positions', 'ncm_sort')
    op.drop_column('tipi_positions', 'parent_ncm')
    op.drop_column('tipi_positions', 'nivel')
