"""Add surveillance activation, cases, and order cancel time.

Revision ID: a8d3c1e4b672
Revises: 1c4e8a7b2d90
"""

from alembic import op
import sqlalchemy as sa


revision = "a8d3c1e4b672"
down_revision = "1c4e8a7b2d90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("canceled_at", sa.DateTime(), nullable=True))
    op.create_table(
        "surveillance_activations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rule_id", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("requested_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'active', 'rejected', 'retired')", name="ck_surveillance_activations_status"),
        sa.CheckConstraint("approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id",
                           name="ck_surveillance_activations_separate_approver"),
    )
    op.create_index("ix_surveillance_activations_rule_id", "surveillance_activations", ["rule_id"])
    op.create_table(
        "surveillance_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rule_id", sa.String(32), nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("subject_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("event_ids", sa.Text(), nullable=False),
        sa.Column("summary", sa.String(255), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="open"),
        sa.Column("disposition", sa.String(20), nullable=True),
        sa.Column("close_reason", sa.String(255), nullable=True),
        sa.Column("opened_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("due_at", sa.DateTime(), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.CheckConstraint("status IN ('open', 'closed')", name="ck_surveillance_cases_status"),
        sa.CheckConstraint("disposition IS NULL OR disposition IN ('true_positive', 'false_positive', 'inconclusive')",
                           name="ck_surveillance_cases_disposition"),
        sa.CheckConstraint("closed_by_user_id IS NULL OR closed_by_user_id <> subject_user_id",
                           name="ck_surveillance_cases_no_self_close"),
    )
    op.create_index("ix_surveillance_cases_rule_id", "surveillance_cases", ["rule_id"])
    op.create_index("ix_surveillance_cases_subject_user_id", "surveillance_cases", ["subject_user_id"])


def downgrade() -> None:
    op.drop_index("ix_surveillance_cases_subject_user_id", table_name="surveillance_cases")
    op.drop_index("ix_surveillance_cases_rule_id", table_name="surveillance_cases")
    op.drop_table("surveillance_cases")
    op.drop_index("ix_surveillance_activations_rule_id", table_name="surveillance_activations")
    op.drop_table("surveillance_activations")
    op.drop_column("orders", "canceled_at")
