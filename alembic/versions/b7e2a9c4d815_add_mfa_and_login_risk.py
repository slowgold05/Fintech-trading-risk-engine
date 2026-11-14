"""Add authenticator factors, login risk events, and login challenges.

Revision ID: b7e2a9c4d815
Revises: a8d3c1e4b672
"""

from alembic import op
import sqlalchemy as sa


revision = "b7e2a9c4d815"
down_revision = "a8d3c1e4b672"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mfa_factors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("method", sa.String(12), nullable=False, server_default="totp"),
        sa.Column("secret_ciphertext", sa.Text(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("last_counter", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("method IN ('totp')", name="ck_mfa_factors_method"),
        sa.UniqueConstraint("user_id", name="uq_mfa_factors_user_id"),
    )
    op.create_table(
        "login_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("user_agent_hash", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(12), nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("step_up_satisfied", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reasons", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("outcome IN ('failure', 'step_up', 'success', 'denied')", name="ck_login_events_outcome"),
    )
    op.create_index("ix_login_events_user_id", "login_events", ["user_id"])
    op.create_index("ix_login_events_ip", "login_events", ["ip"])
    op.create_index("ix_login_events_created_at", "login_events", ["created_at"])
    op.create_table(
        "login_challenges",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("risk_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reasons", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_login_challenges_user_id", "login_challenges", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_login_challenges_user_id", table_name="login_challenges")
    op.drop_table("login_challenges")
    op.drop_index("ix_login_events_created_at", table_name="login_events")
    op.drop_index("ix_login_events_ip", table_name="login_events")
    op.drop_index("ix_login_events_user_id", table_name="login_events")
    op.drop_table("login_events")
    op.drop_table("mfa_factors")
