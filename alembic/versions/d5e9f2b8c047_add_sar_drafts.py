"""Add SAR draft rows.

Revision ID: d5e9f2b8c047
Revises: c4d8e1a7b936
"""

from alembic import op
import sqlalchemy as sa


revision = "d5e9f2b8c047"
down_revision = "c4d8e1a7b936"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sar_drafts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("case_kind", sa.String(16), nullable=False),
        sa.Column("case_id", sa.Integer(), nullable=False),
        sa.Column("event_ids", sa.Text(), nullable=False),
        sa.Column("narrative", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("case_kind IN ('surveillance', 'aml')", name="ck_sar_drafts_kind"),
    )


def downgrade() -> None:
    op.drop_table("sar_drafts")
