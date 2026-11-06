"""Add separate canonical daily research series without relabeling legacy data.

Revision ID: a21c9e7d4b60
Revises: f3a8c2d7e961
"""

from alembic import op
import sqlalchemy as sa


revision = "a21c9e7d4b60"
down_revision = "f3a8c2d7e961"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "market_bars_daily",
        sa.Column("symbol", sa.String(20), sa.ForeignKey("market_symbols.symbol", ondelete="CASCADE"), primary_key=True),
        sa.Column("session_date", sa.Date(), primary_key=True),
        sa.Column("provider", sa.String(32), primary_key=True),
        sa.Column("adjustment_type", sa.String(24), primary_key=True),
        sa.Column("open", sa.Numeric(18, 6), nullable=False),
        sa.Column("high", sa.Numeric(18, 6), nullable=False),
        sa.Column("low", sa.Numeric(18, 6), nullable=False),
        sa.Column("close", sa.Numeric(18, 6), nullable=False),
        sa.Column("volume", sa.BigInteger(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("quality_status", sa.String(16), nullable=False),
        sa.CheckConstraint("trim(provider) <> '' AND provider = trim(provider)", name="ck_market_bars_daily_provider"),
        sa.CheckConstraint("adjustment_type IN ('raw', 'split_adjusted')", name="ck_market_bars_daily_adjustment"),
        sa.CheckConstraint("quality_status IN ('valid', 'flagged', 'rejected')", name="ck_market_bars_daily_quality"),
        sa.CheckConstraint(
            "open > 0 AND open < 1000000000000 AND high > 0 AND high < 1000000000000 "
            "AND low > 0 AND low < 1000000000000 AND close > 0 AND close < 1000000000000",
            name="ck_market_bars_daily_prices",
        ),
        sa.CheckConstraint("low <= open AND open <= high AND low <= close AND close <= high", name="ck_market_bars_daily_ohlc"),
        sa.CheckConstraint("volume >= 0", name="ck_market_bars_daily_volume"),
    )


def downgrade() -> None:
    op.drop_table("market_bars_daily")
