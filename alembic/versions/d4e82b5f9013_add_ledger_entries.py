"""Add the per-account hash-chained posting ledger.

Revision ID: d4e82b5f9013
Revises: c3d71a4e8f02
"""

from alembic import op
import sqlalchemy as sa


revision = "d4e82b5f9013"
down_revision = "c3d71a4e8f02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ledger_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("trades.id"), nullable=True),
        sa.Column("event_id", sa.String(32), nullable=False),
        sa.Column("event_kind", sa.String(32), nullable=False),
        sa.Column("account", sa.String(32), nullable=False),
        sa.Column("asset_id", sa.Integer(), sa.ForeignKey("assets.id"), nullable=True),
        sa.Column("unit", sa.String(32), nullable=False),
        sa.Column("amount", sa.Numeric(24, 6), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("previous_hash", sa.String(64), nullable=False),
        sa.Column("entry_hash", sa.String(64), nullable=False),
    )
    op.create_index("ix_ledger_entries_user_id", "ledger_entries", ["user_id"])
    op.create_index("ix_ledger_entries_trade_id", "ledger_entries", ["trade_id"])
    op.create_index("ix_ledger_entries_event_id", "ledger_entries", ["event_id"])

    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute("""
            CREATE FUNCTION reject_ledger_change() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'Ledger entries are append-only';
            END;
            $$ LANGUAGE plpgsql
        """)
        op.execute("""
            CREATE TRIGGER ledger_entries_no_change BEFORE UPDATE OR DELETE ON ledger_entries
            FOR EACH ROW EXECUTE FUNCTION reject_ledger_change()
        """)
    elif dialect == "mysql":
        for action in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER ledger_entries_no_{action.lower()} BEFORE {action} ON ledger_entries "
                "FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ledger entries are append-only'"
            )
    else:
        raise NotImplementedError(f"Append-only ledger migration is not supported on {dialect}")


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute("DROP TRIGGER ledger_entries_no_change ON ledger_entries")
        op.execute("DROP FUNCTION reject_ledger_change()")
    elif dialect == "mysql":
        op.execute("DROP TRIGGER ledger_entries_no_update")
        op.execute("DROP TRIGGER ledger_entries_no_delete")
    op.drop_index("ix_ledger_entries_event_id", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_trade_id", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_user_id", table_name="ledger_entries")
    op.drop_table("ledger_entries")
