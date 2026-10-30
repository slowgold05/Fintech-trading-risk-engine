"""Store lot quantities and realized P&L as exact decimals.

Revision ID: c3d71a4e8f02
Revises: b1f0a22c7d84
"""

from alembic import op
import sqlalchemy as sa


revision = "c3d71a4e8f02"
down_revision = "b1f0a22c7d84"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("lots", "qty_remaining", existing_type=sa.Float(), type_=sa.Numeric(18, 6), existing_nullable=False)
    op.alter_column("lots", "cost_per_unit", existing_type=sa.Float(), type_=sa.Numeric(18, 6), existing_nullable=False)
    op.alter_column("trades", "realized_pnl", existing_type=sa.Float(), type_=sa.Numeric(18, 2), existing_nullable=False)
    op.alter_column("trades", "realized_pnl_pct", existing_type=sa.Float(), type_=sa.Numeric(12, 4), existing_nullable=False)


def downgrade() -> None:
    op.alter_column("trades", "realized_pnl_pct", existing_type=sa.Numeric(12, 4), type_=sa.Float(), existing_nullable=False)
    op.alter_column("trades", "realized_pnl", existing_type=sa.Numeric(18, 2), type_=sa.Float(), existing_nullable=False)
    op.alter_column("lots", "cost_per_unit", existing_type=sa.Numeric(18, 6), type_=sa.Float(), existing_nullable=False)
    op.alter_column("lots", "qty_remaining", existing_type=sa.Numeric(18, 6), type_=sa.Float(), existing_nullable=False)
