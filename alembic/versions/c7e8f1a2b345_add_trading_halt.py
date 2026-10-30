"""Add an audited database-backed trading halt.

Revision ID: c7e8f1a2b345
Revises: a5d9e6f7c123
"""

from alembic import op
import sqlalchemy as sa

revision = "c7e8f1a2b345"
down_revision = "a5d9e6f7c123"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trading_halt_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("halted", sa.Boolean(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("changed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("id = 1", name="ck_trading_halt_singleton"),
    )
    op.create_table(
        "trading_halt_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("previous_halted", sa.Boolean(), nullable=False),
        sa.Column("halted", sa.Boolean(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("changed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    state = sa.table("trading_halt_state", sa.column("id", sa.Integer()),
                     sa.column("halted", sa.Boolean()), sa.column("reason", sa.String()))
    op.bulk_insert(state, [{"id": 1, "halted": False, "reason": "Initial trading state"}])

    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute("""
            CREATE FUNCTION audit_trading_halt() RETURNS trigger AS $$
            BEGIN
                IF OLD.halted IS DISTINCT FROM NEW.halted THEN
                    INSERT INTO trading_halt_events (previous_halted, halted, actor_user_id, reason)
                    VALUES (OLD.halted, NEW.halted, NEW.actor_user_id, NEW.reason);
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        """)
        op.execute("CREATE TRIGGER trading_halt_audit AFTER UPDATE ON trading_halt_state FOR EACH ROW EXECUTE FUNCTION audit_trading_halt()")
        op.execute("CREATE FUNCTION reject_trading_halt_event_edit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Trading halt events are append-only'; END; $$ LANGUAGE plpgsql")
        op.execute("CREATE TRIGGER trading_halt_events_no_edit BEFORE UPDATE OR DELETE ON trading_halt_events FOR EACH ROW EXECUTE FUNCTION reject_trading_halt_event_edit()")
    elif dialect == "mysql":
        op.execute("""
            CREATE TRIGGER trading_halt_audit AFTER UPDATE ON trading_halt_state FOR EACH ROW
            INSERT INTO trading_halt_events (previous_halted, halted, actor_user_id, reason)
            SELECT OLD.halted, NEW.halted, NEW.actor_user_id, NEW.reason
            WHERE OLD.halted <> NEW.halted
        """)
        for action in ("UPDATE", "DELETE"):
            op.execute(f"CREATE TRIGGER trading_halt_events_no_{action.lower()} BEFORE {action} ON trading_halt_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trading halt events are append-only'")
    else:
        raise NotImplementedError(f"Trading halt trigger is not supported on {dialect}")


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute("DROP TRIGGER trading_halt_events_no_edit ON trading_halt_events")
        op.execute("DROP FUNCTION reject_trading_halt_event_edit()")
        op.execute("DROP TRIGGER trading_halt_audit ON trading_halt_state")
        op.execute("DROP FUNCTION audit_trading_halt()")
    elif dialect == "mysql":
        op.execute("DROP TRIGGER trading_halt_events_no_update")
        op.execute("DROP TRIGGER trading_halt_events_no_delete")
        op.execute("DROP TRIGGER trading_halt_audit")
    op.drop_table("trading_halt_events")
    op.drop_table("trading_halt_state")
