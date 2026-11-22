"""Store private one-shot rules and their last raw close observation."""

from alembic import op
import sqlalchemy as sa


revision = "n261118a0001"
down_revision = "n261118e0001"
branch_labels = None
depends_on = None


GRANTS = """
GRANT SELECT, DELETE ON night_alerts TO fintech_app;
GRANT INSERT (user_id, symbol, direction, target) ON night_alerts TO fintech_app;
GRANT UPDATE (last_date, last_close, last_provider, last_observed_at, triggered_at) ON night_alerts TO fintech_app;
GRANT USAGE, SELECT ON SEQUENCE night_alerts_id_seq TO fintech_app;
"""


def upgrade() -> None:
    op.create_table(
        "night_alerts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol", sa.String(20), sa.ForeignKey("market_symbols.symbol"), nullable=False),
        sa.Column("direction", sa.String(12), nullable=False),
        sa.Column("target", sa.Numeric(18, 6), nullable=False),
        sa.Column("last_date", sa.Date),
        sa.Column("last_close", sa.Numeric(18, 6)),
        sa.Column("last_provider", sa.String(32)),
        sa.Column("last_observed_at", sa.DateTime(timezone=True)),
        sa.Column("triggered_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("direction IN ('at_or_above', 'at_or_below')", name="ck_night_alerts_direction"),
        sa.CheckConstraint("target > 0 AND target < 1000000000000", name="ck_night_alerts_target"),
        sa.CheckConstraint(
            "(last_date IS NULL AND last_close IS NULL AND last_provider IS NULL AND last_observed_at IS NULL "
            "AND triggered_at IS NULL) OR (last_date IS NOT NULL AND last_close IS NOT NULL "
            "AND last_close > 0 AND last_close < 1000000000000 "
            "AND last_provider IS NOT NULL AND last_observed_at IS NOT NULL)",
            name="ck_night_alerts_observation",
        ),
    )
    op.create_index("ix_night_alerts_owner", "night_alerts", ["user_id", "id"])
    op.create_index(
        "uq_night_alerts_active_rule", "night_alerts", ["user_id", "symbol", "direction", "target"], unique=True,
        postgresql_where=sa.text("triggered_at IS NULL"), sqlite_where=sa.text("triggered_at IS NULL"),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute(f"DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fintech_app') THEN {GRANTS} END IF; END $$")


def downgrade() -> None:
    op.drop_table("night_alerts")
