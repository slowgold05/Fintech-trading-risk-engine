"""Record demo seed manifests, archived sessions and historical effective dates.

Revision ID: e462fc80a937
Revises: b7c91a0e4d62
"""

from alembic import op
import sqlalchemy as sa

revision = "e462fc80a937"
down_revision = "b7c91a0e4d62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("demo_seed", sa.JSON()))
    op.add_column("users", sa.Column("demo_archived_at", sa.DateTime(), server_default=sa.null()))
    op.create_check_constraint("ck_users_demo_trader", "users", "demo_seed IS NULL OR role = 'trader'")
    op.create_check_constraint(
        "ck_users_demo_archive", "users", "demo_archived_at IS NULL OR demo_seed IS NOT NULL"
    )
    op.create_index(
        "ix_users_demo_created_at", "users", ["created_at"], postgresql_where=sa.text("demo_seed IS NOT NULL")
    )
    op.add_column("trades", sa.Column("demo_seed", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("ledger_entries", sa.Column("effective_on", sa.Date()))


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT 1 FROM users WHERE demo_seed IS NOT NULL LIMIT 1")).first():
        raise RuntimeError("Cannot discard demo account metadata or hash-chained effective dates")
    op.drop_column("ledger_entries", "effective_on")
    op.drop_column("trades", "demo_seed")
    op.drop_index("ix_users_demo_created_at", table_name="users")
    op.drop_constraint("ck_users_demo_archive", "users", type_="check")
    op.drop_constraint("ck_users_demo_trader", "users", type_="check")
    op.drop_column("users", "demo_archived_at")
    op.drop_column("users", "demo_seed")
