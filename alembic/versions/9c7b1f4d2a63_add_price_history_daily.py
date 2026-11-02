"""add price history daily

Revision ID: 9c7b1f4d2a63
Revises: 7e9d4c1a2b30
Create Date: 2026-07-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9c7b1f4d2a63"
down_revision: Union[str, Sequence[str], None] = "7e9d4c1a2b30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "price_history_daily",
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("open", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("high", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("low", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("close", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("volume", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["symbol"], ["market_symbols.symbol"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("symbol", "date"),
        sa.UniqueConstraint("symbol", "date", name="uq_price_history_daily_symbol_date"),
    )
    op.create_index("ix_price_history_daily_date", "price_history_daily", ["date"])


def downgrade() -> None:
    op.drop_index("ix_price_history_daily_date", table_name="price_history_daily")
    op.drop_table("price_history_daily")
