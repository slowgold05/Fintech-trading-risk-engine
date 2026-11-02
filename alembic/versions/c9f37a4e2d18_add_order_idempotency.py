"""Reserve order idempotency keys in the same transaction as execution.

Revision ID: c9f37a4e2d18
Revises: b8c26f9d4357
"""

from alembic import op
import sqlalchemy as sa

revision = "c9f37a4e2d18"
down_revision = "b8c26f9d4357"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "order_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response", sa.JSON(), nullable=True),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_order_requests_user_key"),
    )


def downgrade() -> None:
    op.drop_table("order_requests")
