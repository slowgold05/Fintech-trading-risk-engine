"""Add detection cursors and a scheduler lease with its next due time.

Revision ID: f3a8c2d7e961
Revises: e7b2c5d9a174
"""

from alembic import op
import sqlalchemy as sa


revision = "f3a8c2d7e961"
down_revision = "e7b2c5d9a174"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "detection_cursors",
        sa.Column("name", sa.String(32), primary_key=True),
        sa.Column("scanned_through", sa.DateTime(), nullable=True),
        sa.Column("pending_since", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("name IN ('surveillance', 'aml')", name="ck_detection_cursors_name"),
    )
    op.create_table(
        "scheduler_locks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner", sa.String(64), nullable=True),
        sa.Column("acquired_at", sa.DateTime(), nullable=True),
        sa.Column("next_due", sa.DateTime(), nullable=True),
    )
    op.execute("INSERT INTO scheduler_locks (id, owner, acquired_at, next_due) VALUES (1, NULL, NULL, NULL)")


def downgrade() -> None:
    op.drop_table("scheduler_locks")
    op.drop_table("detection_cursors")
