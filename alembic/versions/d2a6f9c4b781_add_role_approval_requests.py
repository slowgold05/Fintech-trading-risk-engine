"""Add two-person approval requests for role changes.

Revision ID: d2a6f9c4b781
Revises: c9f37a4e2d18
"""

from alembic import op
import sqlalchemy as sa

revision = "d2a6f9c4b781"
down_revision = "c9f37a4e2d18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "role_change_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("target_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("old_role", sa.String(24), nullable=False),
        sa.Column("new_role", sa.String(24), nullable=False),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("requested_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'approved', 'applied')", name="ck_role_change_requests_status"),
        sa.CheckConstraint("approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id",
                           name="ck_role_change_requests_separate_approver"),
    )
    op.add_column("role_changes", sa.Column("request_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_role_changes_request_id", "role_changes", "role_change_requests", ["request_id"], ["id"])


def downgrade() -> None:
    op.drop_constraint("fk_role_changes_request_id", "role_changes", type_="foreignkey")
    op.drop_column("role_changes", "request_id")
    op.drop_table("role_change_requests")
