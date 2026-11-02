"""Guard account balances and position quantities.

Revision ID: b1f0a22c7d84
Revises: 6b4d2e7c9f10
"""

from alembic import op


revision = "b1f0a22c7d84"
down_revision = "6b4d2e7c9f10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_check_constraint("ck_users_cash_nonnegative", "users", "cash_balance >= 0")
    op.create_check_constraint("ck_holdings_quantity_nonnegative", "holdings", "quantity >= 0")
    op.create_check_constraint("ck_lots_qty_nonnegative", "lots", "qty_remaining >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_lots_qty_nonnegative", "lots", type_="check")
    op.drop_constraint("ck_holdings_quantity_nonnegative", "holdings", type_="check")
    op.drop_constraint("ck_users_cash_nonnegative", "users", type_="check")
