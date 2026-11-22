"""Persist explicit demo ranking opt-ins and their public aliases."""

from alembic import op
import sqlalchemy as sa


revision = "n261118l0001"
down_revision = "n261118j0001"
branch_labels = None
depends_on = None


GRANTS = """
GRANT SELECT, DELETE ON night_leaderboard_entries TO fintech_app;
GRANT INSERT (user_id, alias) ON night_leaderboard_entries TO fintech_app;
GRANT UPDATE (alias) ON night_leaderboard_entries TO fintech_app;
"""


def upgrade() -> None:
    op.create_table(
        "night_leaderboard_entries",
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"),
                  primary_key=True, autoincrement=False),
        sa.Column("alias", sa.String(24).with_variant(sa.String(24, collation="C"), "postgresql"), nullable=False),
        sa.CheckConstraint("length(alias) BETWEEN 3 AND 24 AND alias = trim(alias)", name="ck_night_leaderboard_alias"),
    )
    op.create_index("uq_night_leaderboard_alias", "night_leaderboard_entries", [sa.text("lower(alias)")], unique=True)
    if op.get_context().dialect.name == "postgresql":
        op.execute(f"DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fintech_app') THEN {GRANTS} END IF; END $$")


def downgrade() -> None:
    op.drop_table("night_leaderboard_entries")
