"""Add immediate market orders.

Revision ID: a7b15e8c3246
Revises: f6a04d7b2135
"""

from alembic import op
import sqlalchemy as sa

revision = "a7b15e8c3246"
down_revision = "f6a04d7b2135"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("order_type", sa.String(10), nullable=False, server_default="limit"))
    op.drop_constraint("ck_orders_limit_price_positive", "orders", type_="check")
    op.alter_column("orders", "limit_price", existing_type=sa.Numeric(18, 6), nullable=True)
    op.create_check_constraint("ck_orders_price_for_type", "orders", "(order_type = 'limit' AND limit_price > 0) OR (order_type = 'market' AND limit_price IS NULL)")


def downgrade() -> None:
    op.drop_constraint("ck_orders_price_for_type", "orders", type_="check")
    op.alter_column("orders", "limit_price", existing_type=sa.Numeric(18, 6), nullable=False)
    op.create_check_constraint("ck_orders_limit_price_positive", "orders", "limit_price > 0")
    op.drop_column("orders", "order_type")
