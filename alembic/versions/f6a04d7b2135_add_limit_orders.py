"""Add persistent limit orders and link fills to their order.

Revision ID: f6a04d7b2135
Revises: e5f93c6a1024
"""

from alembic import op
import sqlalchemy as sa


revision = "f6a04d7b2135"
down_revision = "e5f93c6a1024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("asset_id", sa.Integer(), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column("side", sa.String(10), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("remaining_quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("limit_price", sa.Numeric(18, 6), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_orders_quantity_positive"),
        sa.CheckConstraint("remaining_quantity >= 0 AND remaining_quantity <= quantity", name="ck_orders_remaining_valid"),
        sa.CheckConstraint("limit_price > 0", name="ck_orders_limit_price_positive"),
        sa.CheckConstraint("side IN ('buy', 'sell')", name="ck_orders_side_valid"),
        sa.CheckConstraint("status IN ('open', 'filled', 'canceled')", name="ck_orders_status_valid"),
    )
    op.create_index("ix_orders_user_id", "orders", ["user_id"])
    op.create_index("ix_orders_asset_id", "orders", ["asset_id"])
    op.add_column("trades", sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=True))
    op.create_index("ix_trades_order_id", "trades", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_trades_order_id", table_name="trades")
    op.drop_column("trades", "order_id")
    op.drop_index("ix_orders_asset_id", table_name="orders")
    op.drop_index("ix_orders_user_id", table_name="orders")
    op.drop_table("orders")
