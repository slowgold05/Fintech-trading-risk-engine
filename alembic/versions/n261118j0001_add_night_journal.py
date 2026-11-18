"""Attach one private journal entry to an owned receipt."""

from alembic import op
import sqlalchemy as sa


revision = "n261118j0001"
down_revision = "n261118a0001"
branch_labels = None
depends_on = None


GRANTS = """
GRANT SELECT, DELETE ON night_journal_entries TO fintech_app;
GRANT INSERT (user_id, order_id, note, tags) ON night_journal_entries TO fintech_app;
GRANT UPDATE (note, tags, updated_at) ON night_journal_entries TO fintech_app;
GRANT USAGE, SELECT ON SEQUENCE night_journal_entries_id_seq TO fintech_app;
"""


def upgrade() -> None:
    with op.batch_alter_table("orders") as batch:
        batch.create_unique_constraint("uq_orders_night_journal_owner", ["id", "user_id"])
    op.create_table(
        "night_journal_entries",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.Integer, nullable=False),
        sa.Column("note", sa.Text, nullable=False),
        sa.Column("tags", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["order_id", "user_id"], ["orders.id", "orders.user_id"],
            ondelete="CASCADE", name="fk_night_journal_owned_order",
        ),
        sa.UniqueConstraint("user_id", "order_id", name="uq_night_journal_owned_order"),
        sa.CheckConstraint("length(note) BETWEEN 1 AND 2000", name="ck_night_journal_note"),
        sa.CheckConstraint("json_array_length(tags) <= 5", name="ck_night_journal_tags"),
    )
    op.create_index("ix_night_journal_owner_page", "night_journal_entries", ["user_id", "id"])
    if op.get_context().dialect.name == "postgresql":
        op.execute(f"DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fintech_app') THEN {GRANTS} END IF; END $$")


def downgrade() -> None:
    op.drop_table("night_journal_entries")
    with op.batch_alter_table("orders") as batch:
        batch.drop_constraint("uq_orders_night_journal_owner", type_="unique")
