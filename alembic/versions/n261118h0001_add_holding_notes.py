"""Add private notes keyed by owner and asset.

Revision ID: n261118h0001
Revises: n261118l0001
"""

import sqlalchemy as sa
from alembic import op


revision = "n261118h0001"
down_revision = "n261118l0001"
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
    if op.get_bind().dialect.name == "postgresql":
        op.execute("""
            DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fintech_app') THEN
                GRANT SELECT, INSERT, DELETE ON public.night_holding_notes TO fintech_app;
                GRANT UPDATE (text, updated_at) ON public.night_holding_notes TO fintech_app;
            END IF; END $$
        """)


def downgrade() -> None:
    op.drop_table("night_holding_notes")
