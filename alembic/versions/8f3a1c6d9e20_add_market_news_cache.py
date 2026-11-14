"""add market news cache

Revision ID: 8f3a1c6d9e20
Revises: 45d85a1871f0
Create Date: 2026-11-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8f3a1c6d9e20"
down_revision: Union[str, Sequence[str], None] = "45d85a1871f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "market_news_cache",
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("symbol"),
    )
    op.create_index("ix_market_news_cache_fetched_at", "market_news_cache", ["fetched_at"])


def downgrade() -> None:
    op.drop_index("ix_market_news_cache_fetched_at", table_name="market_news_cache")
    op.drop_table("market_news_cache")
