"""add research reports

Revision ID: b6e2d9a4c175
Revises: c9e4a7b2d618
Create Date: 2026-11-08
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b6e2d9a4c175"
down_revision: Union[str, Sequence[str], None] = "c9e4a7b2d618"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "research_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("research_jobs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol", sa.String(length=20), sa.ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("bull_case", sa.Text(), nullable=True),
        sa.Column("bear_case", sa.Text(), nullable=True),
        sa.Column("synthesis", sa.Text(), nullable=True),
        sa.Column("risks", sa.Text(), nullable=True),
        sa.Column("model_version", sa.String(length=64), nullable=True),
        sa.Column("prompt_version", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_research_reports_job_id", "research_reports", ["job_id"])
    op.create_index("ix_research_reports_user_id", "research_reports", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_research_reports_user_id", table_name="research_reports")
    op.drop_index("ix_research_reports_job_id", table_name="research_reports")
    op.drop_table("research_reports")
