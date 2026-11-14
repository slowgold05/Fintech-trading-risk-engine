"""add forecast results

Revision ID: f2c8e5a1d734
Revises: d8e1b4c7a902
Create Date: 2026-11-08
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2c8e5a1d734"
down_revision: Union[str, Sequence[str], None] = "d8e1b4c7a902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "forecast_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("forecast_jobs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol", sa.String(length=20), sa.ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("adjustment_type", sa.String(length=20), nullable=False),
        sa.Column("model_name", sa.String(length=128), nullable=False),
        sa.Column("tokenizer_name", sa.String(length=128), nullable=False),
        sa.Column("lookback", sa.Integer(), nullable=False),
        sa.Column("horizon", sa.Integer(), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("input_cutoff", sa.String(length=10), nullable=False),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.Column("bars", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_forecast_results_job_id", "forecast_results", ["job_id"])
    op.create_index("ix_forecast_results_user_id", "forecast_results", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_forecast_results_user_id", table_name="forecast_results")
    op.drop_index("ix_forecast_results_job_id", table_name="forecast_results")
    op.drop_table("forecast_results")
