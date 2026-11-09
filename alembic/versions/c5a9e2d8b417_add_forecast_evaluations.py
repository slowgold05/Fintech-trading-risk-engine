"""add forecast evaluations

Revision ID: c5a9e2d8b417
Revises: f2c8e5a1d734
Create Date: 2026-11-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c5a9e2d8b417"
down_revision: Union[str, Sequence[str], None] = "f2c8e5a1d734"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "forecast_evaluations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("symbol", sa.String(length=20), sa.ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("adjustment_type", sa.String(length=20), nullable=False),
        sa.Column("horizon", sa.Integer(), nullable=False),
        sa.Column("window_count", sa.Integer(), nullable=False),
        sa.Column("model_mae", sa.Float(), nullable=False),
        sa.Column("model_directional_accuracy", sa.Float(), nullable=False),
        sa.Column("baseline_type", sa.String(length=32), nullable=False),
        sa.Column("baseline_mae", sa.Float(), nullable=False),
        sa.Column("baseline_directional_accuracy", sa.Float(), nullable=False),
        sa.Column("weights_exercised", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_forecast_evaluations_symbol", "forecast_evaluations", ["symbol"])


def downgrade() -> None:
    op.drop_index("ix_forecast_evaluations_symbol", table_name="forecast_evaluations")
    op.drop_table("forecast_evaluations")
