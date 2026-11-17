"""Cache Massive ticker share counts for company research.

Revision ID: a4c8e2b7d915
Revises: 8f3a1c6d9e20
"""

from alembic import op
import sqlalchemy as sa


revision = "a4c8e2b7d915"
down_revision = "8f3a1c6d9e20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "market_reference_cache",
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("shares_outstanding", sa.Numeric(precision=24, scale=4), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("symbol"),
    )
    op.create_index(
        "ix_market_reference_cache_fetched_at",
        "market_reference_cache",
        ["fetched_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_market_reference_cache_fetched_at", table_name="market_reference_cache")
    op.drop_table("market_reference_cache")
