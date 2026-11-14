"""add research report backend detail

Revision ID: a9c3e7d1f504
Revises: c8f1a3d7e492
Create Date: 2026-11-08
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9c3e7d1f504"
down_revision: Union[str, Sequence[str], None] = "c8f1a3d7e492"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("research_reports", sa.Column("backend_detail", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("research_reports", "backend_detail")
