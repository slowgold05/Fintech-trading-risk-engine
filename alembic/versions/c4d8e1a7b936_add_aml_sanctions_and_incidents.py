"""Add cash movements, sanctions screens, AML cases, and incidents.

Revision ID: c4d8e1a7b936
Revises: b7e2a9c4d815
"""

from alembic import op
import sqlalchemy as sa


revision = "c4d8e1a7b936"
down_revision = "b7e2a9c4d815"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("full_name", sa.String(length=255), nullable=True))
    op.create_table(
        "sanctions_screens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("subject_name", sa.String(255), nullable=False),
        sa.Column("context", sa.String(16), nullable=False),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("matched_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("context IN ('onboarding', 'payout')", name="ck_sanctions_screens_context"),
        sa.CheckConstraint("decision IN ('clear', 'blocked', 'provider_error')", name="ck_sanctions_screens_decision"),
    )
    op.create_index("ix_sanctions_screens_user_id", "sanctions_screens", ["user_id"])
    op.create_table(
        "cash_movements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("screening_id", sa.Integer(), sa.ForeignKey("sanctions_screens.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('deposit', 'withdrawal')", name="ck_cash_movements_kind"),
        sa.CheckConstraint("amount > 0", name="ck_cash_movements_amount"),
    )
    op.create_index("ix_cash_movements_user_id", "cash_movements", ["user_id"])
    op.create_table(
        "aml_activations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rule_id", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("requested_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'active', 'rejected', 'retired')", name="ck_aml_activations_status"),
        sa.CheckConstraint(
            "approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id",
            name="ck_aml_activations_separate_approver",
        ),
    )
    op.create_index("ix_aml_activations_rule_id", "aml_activations", ["rule_id"])
    op.create_table(
        "aml_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rule_id", sa.String(32), nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("subject_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_ids", sa.Text(), nullable=False),
        sa.Column("summary", sa.String(255), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default=sa.text("'open'")),
        sa.Column("disposition", sa.String(20), nullable=True),
        sa.Column("close_reason", sa.String(255), nullable=True),
        sa.Column("opened_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("due_at", sa.DateTime(), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.CheckConstraint("status IN ('open', 'closed')", name="ck_aml_cases_status"),
        sa.CheckConstraint(
            "disposition IS NULL OR disposition IN ('true_positive', 'false_positive', 'inconclusive')",
            name="ck_aml_cases_disposition",
        ),
        sa.CheckConstraint(
            "closed_by_user_id IS NULL OR closed_by_user_id <> subject_user_id",
            name="ck_aml_cases_no_self_close",
        ),
    )
    op.create_index("ix_aml_cases_rule_id", "aml_cases", ["rule_id"])
    op.create_index("ix_aml_cases_subject_user_id", "aml_cases", ["subject_user_id"])
    op.create_table(
        "incidents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default=sa.text("'open'")),
        sa.Column("summary", sa.String(255), nullable=False),
        sa.Column("discovered_at", sa.DateTime(), nullable=False),
        sa.Column("customer_notice_due_at", sa.DateTime(), nullable=False),
        sa.Column("customer_notified_at", sa.DateTime(), nullable=True),
        sa.Column("opened_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("notified_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("closed_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("severity IN ('low', 'moderate', 'high')", name="ck_incidents_severity"),
        sa.CheckConstraint("status IN ('open', 'closed')", name="ck_incidents_status"),
        sa.CheckConstraint(
            "notified_by_user_id IS NULL OR notified_by_user_id <> opened_by_user_id",
            name="ck_incidents_separate_notice",
        ),
        sa.CheckConstraint(
            "closed_by_user_id IS NULL OR closed_by_user_id <> opened_by_user_id",
            name="ck_incidents_separate_close",
        ),
    )


def downgrade() -> None:
    op.drop_table("incidents")
    op.drop_table("aml_cases")
    op.drop_table("aml_activations")
    op.drop_table("cash_movements")
    op.drop_table("sanctions_screens")
    op.drop_column("users", "full_name")
