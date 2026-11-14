"""add research briefs

Revision ID: c8f1a3d7e492
Revises: b6e2d9a4c175
Create Date: 2026-11-08
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8f1a3d7e492"
down_revision: Union[str, Sequence[str], None] = "b6e2d9a4c175"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "research_briefs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("brief_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("entries", sa.JSON(), nullable=False),
    )
    op.create_index("ix_research_briefs_user_id", "research_briefs", ["user_id"])
    op.create_index(
        "uq_research_briefs_user_date",
        "research_briefs",
        ["user_id", "brief_date"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_research_briefs_user_date", table_name="research_briefs")
    op.drop_index("ix_research_briefs_user_id", table_name="research_briefs")
    op.drop_table("research_briefs")
