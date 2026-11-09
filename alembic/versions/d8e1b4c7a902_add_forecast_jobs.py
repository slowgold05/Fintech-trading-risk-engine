"""add forecast jobs

Revision ID: d8e1b4c7a902
Revises: a9c3e7d1f504
Create Date: 2026-11-08
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8e1b4c7a902"
down_revision: Union[str, Sequence[str], None] = "a9c3e7d1f504"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "forecast_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol", sa.String(length=20), sa.ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("adjustment_type", sa.String(length=20), nullable=False),
        sa.Column("lookback", sa.Integer(), nullable=False),
        sa.Column("horizon", sa.Integer(), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.CheckConstraint(
            "status in ('queued','running','completed','failed','cancelled')",
            name="ck_forecast_jobs_status",
        ),
    )
    op.create_index("ix_forecast_jobs_user_id", "forecast_jobs", ["user_id"])
    op.create_index("ix_forecast_jobs_status", "forecast_jobs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_forecast_jobs_status", table_name="forecast_jobs")
    op.drop_index("ix_forecast_jobs_user_id", table_name="forecast_jobs")
    op.drop_table("forecast_jobs")
