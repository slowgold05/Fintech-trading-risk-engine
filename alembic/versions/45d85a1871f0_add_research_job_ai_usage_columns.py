"""add research job ai usage columns

Revision ID: 45d85a1871f0
Revises: c5a9e2d8b417
Create Date: 2026-11-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "45d85a1871f0"
down_revision: Union[str, Sequence[str], None] = "c5a9e2d8b417"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("research_jobs", sa.Column("prompt_tokens", sa.Integer(), nullable=True))
    op.add_column("research_jobs", sa.Column("completion_tokens", sa.Integer(), nullable=True))
    op.add_column("research_jobs", sa.Column("duration_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("research_jobs", "duration_ms")
    op.drop_column("research_jobs", "completion_tokens")
    op.drop_column("research_jobs", "prompt_tokens")
