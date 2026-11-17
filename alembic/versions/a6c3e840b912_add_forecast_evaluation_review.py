"""add forecast evaluation review status

Revision ID: a6c3e840b912
Revises: b7c91a0e4d62
Create Date: 2026-11-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a6c3e840b912"
down_revision: Union[str, Sequence[str], None] = "b7c91a0e4d62"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "forecast_evaluations",
        sa.Column(
            "review_status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )
    op.create_check_constraint(
        "ck_forecast_evaluations_review_status",
        "forecast_evaluations",
        "review_status IN ('pending', 'approved')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_forecast_evaluations_review_status",
        "forecast_evaluations",
        type_="check",
    )
    op.drop_column("forecast_evaluations", "review_status")
