"""add market filings cache

Revision ID: e1a7c3b5d820
Revises: b73e2d9f6a10
Create Date: 2026-11-08
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1a7c3b5d820"
down_revision: Union[str, Sequence[str], None] = "b73e2d9f6a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "market_filings_cache",
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("cik", sa.String(length=10), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("symbol"),
    )
    op.create_index("ix_market_filings_cache_cik", "market_filings_cache", ["cik"])
    op.create_index("ix_market_filings_cache_fetched_at", "market_filings_cache", ["fetched_at"])


def downgrade() -> None:
    op.drop_index("ix_market_filings_cache_fetched_at", table_name="market_filings_cache")
    op.drop_index("ix_market_filings_cache_cik", table_name="market_filings_cache")
    op.drop_table("market_filings_cache")
