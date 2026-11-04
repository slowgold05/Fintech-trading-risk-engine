"""Add propose-only intents, findings, briefs, and alerts.

Revision ID: e7b2c5d9a174
Revises: d5e9f2b8c047
"""

from alembic import op
import sqlalchemy as sa


revision = "e7b2c5d9a174"
down_revision = "d5e9f2b8c047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trade_intents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("reference_price", sa.Numeric(18, 6), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Numeric(4, 3), nullable=False),
        sa.Column("data_used", sa.Text(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("rejection_reason", sa.String(255), nullable=True),
        sa.Column("proposed_by", sa.String(64), nullable=False),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("side IN ('buy', 'sell')", name="ck_trade_intents_side"),
        sa.CheckConstraint("status IN ('proposed', 'rejected', 'approved')", name="ck_trade_intents_status"),
    )
    op.create_table(
        "findings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("control_id", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(12), nullable=False),
        sa.Column("owner", sa.String(64), nullable=False),
        sa.Column("summary", sa.String(255), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=False),
        sa.Column("opened_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('open', 'remediated')", name="ck_findings_status"),
        sa.CheckConstraint("severity IN ('low', 'moderate', 'high')", name="ck_findings_severity"),
    )
    op.create_table(
        "risk_briefs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("brief_date", sa.Date(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("figures", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "expansion_alerts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("summary", sa.String(255), nullable=False),
        sa.Column("evidence_ref", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("expansion_alerts")
    op.drop_table("risk_briefs")
    op.drop_table("findings")
    op.drop_table("trade_intents")
