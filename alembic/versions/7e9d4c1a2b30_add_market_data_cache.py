"""add persistent market data cache

Revision ID: 7e9d4c1a2b30
Revises: d0a016224f51
Create Date: 2026-06-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7e9d4c1a2b30"
down_revision: Union[str, Sequence[str], None] = "d0a016224f51"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "market_symbols",
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("company_name", sa.String(length=255), nullable=False),
        sa.Column("exchange", sa.String(length=40), nullable=False),
        sa.Column("sector", sa.String(length=80), nullable=True),
        sa.Column("cik", sa.String(length=10), nullable=True),
        sa.Column("is_etf", sa.Boolean(), nullable=False),
        sa.Column("is_test", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("refresh_tier", sa.String(length=16), nullable=False),
        sa.Column("heatmap_size", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("synced_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("symbol"),
    )
    op.create_index("ix_market_symbols_cik", "market_symbols", ["cik"])
    op.create_index("ix_market_symbols_is_active", "market_symbols", ["is_active"])
    op.create_index("ix_market_symbols_refresh_tier", "market_symbols", ["refresh_tier"])
    op.create_index("ix_market_symbols_sector", "market_symbols", ["sector"])

    op.create_table(
        "market_quote_cache",
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("price", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("change_amount", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("change_percent", sa.Numeric(precision=10, scale=4), nullable=False),
        sa.Column("volume", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["symbol"], ["market_symbols.symbol"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("symbol"),
    )
    op.create_index("ix_market_quote_cache_fetched_at", "market_quote_cache", ["fetched_at"])

    op.create_table(
        "market_fundamentals_cache",
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("cik", sa.String(length=10), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("symbol"),
    )
    op.create_index("ix_market_fundamentals_cache_cik", "market_fundamentals_cache", ["cik"])
    op.create_index("ix_market_fundamentals_cache_fetched_at", "market_fundamentals_cache", ["fetched_at"])


def downgrade() -> None:
    op.drop_index("ix_market_fundamentals_cache_fetched_at", table_name="market_fundamentals_cache")
    op.drop_index("ix_market_fundamentals_cache_cik", table_name="market_fundamentals_cache")
    op.drop_table("market_fundamentals_cache")
    op.drop_index("ix_market_quote_cache_fetched_at", table_name="market_quote_cache")
    op.drop_table("market_quote_cache")
    op.drop_index("ix_market_symbols_sector", table_name="market_symbols")
    op.drop_index("ix_market_symbols_refresh_tier", table_name="market_symbols")
    op.drop_index("ix_market_symbols_is_active", table_name="market_symbols")
    op.drop_index("ix_market_symbols_cik", table_name="market_symbols")
    op.drop_table("market_symbols")
