"""Add user-owned watchlists and ordered membership rows.

Revision ID: b73e2d9f6a10
Revises: a21c9e7d4b60

Frozen table definitions. Do not import application models.
"""

from alembic import op
import sqlalchemy as sa


revision = "b73e2d9f6a10"
down_revision = "a21c9e7d4b60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watchlists",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.UniqueConstraint("user_id", "name", name="uq_watchlists_user_name"),
        sa.CheckConstraint("length(name) >= 1 AND length(name) <= 40", name="ck_watchlists_name_length"),
    )
    op.create_index("ix_watchlists_user_id", "watchlists", ["user_id"])
    op.create_table(
        "watchlist_items",
        sa.Column("watchlist_id", sa.Integer(), sa.ForeignKey("watchlists.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("symbol", sa.String(20), sa.ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint("position >= 1", name="ck_watchlist_items_position_positive"),
    )


def downgrade() -> None:
    op.drop_table("watchlist_items")
    op.drop_table("watchlists")
