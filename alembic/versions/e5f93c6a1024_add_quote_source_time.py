"""Record the provider date separately from cache fetch time.

Revision ID: e5f93c6a1024
Revises: d4e82b5f9013
"""

from alembic import op
import sqlalchemy as sa


revision = "e5f93c6a1024"
down_revision = "d4e82b5f9013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("market_quote_cache", sa.Column("quote_at", sa.DateTime(), nullable=True))
    op.execute("""
        UPDATE market_quote_cache
        SET quote_at = (
            SELECT MAX(date) FROM price_history_daily
            WHERE price_history_daily.symbol = market_quote_cache.symbol
        )
        WHERE source = 'yahoo'
    """)


def downgrade() -> None:
    op.drop_column("market_quote_cache", "quote_at")
