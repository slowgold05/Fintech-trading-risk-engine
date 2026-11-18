"""Store the first time an owner read an inbox event."""

from alembic import op
import sqlalchemy as sa


revision = "n261118i0001"
down_revision = "d01cfb893a64"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "night_inbox_reads",
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("event_key", sa.String(64), primary_key=True),
        sa.Column("read_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("""
            DO $$ BEGIN
                IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fintech_app') THEN
                    GRANT SELECT, INSERT ON public.night_inbox_reads TO fintech_app;
                END IF;
            END $$;
        """)


def downgrade() -> None:
    op.drop_table("night_inbox_reads")
