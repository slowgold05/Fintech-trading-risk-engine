"""Add private notes keyed by owner and asset.

Revision ID: n261118h0001
Revises: d01cfb893a64
"""

import sqlalchemy as sa
from alembic import op


revision = "n261118h0001"
down_revision = "d01cfb893a64"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "night_holding_notes",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_id", sa.Integer(), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "asset_id"),
        sa.CheckConstraint("length(text) BETWEEN 1 AND 2000", name="ck_night_holding_note_text_length"),
    )


def downgrade() -> None:
    op.drop_table("night_holding_notes")
