"""add user cash balance

Revision ID: 2f8b6c4d1a90
Revises: 9c7b1f4d2a63
Create Date: 2026-07-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "2f8b6c4d1a90"
down_revision: Union[str, Sequence[str], None] = "9c7b1f4d2a63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "cash_balance",
            sa.Numeric(precision=18, scale=2),
            nullable=False,
            server_default="100000.00",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "cash_balance")
