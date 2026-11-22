"""Store the provider and exchange session used for simulated fills."""

from alembic import op
import sqlalchemy as sa

revision = "n261118e0001"
down_revision = "d01cfb893a64"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("orders", "trades"):
        op.add_column(table, sa.Column("simulated_quote_source", sa.String(32), nullable=True))
        op.add_column(table, sa.Column("simulated_quote_date", sa.Date(), nullable=True))
        # The recorded quote timestamp already encodes the session. The
        # replaceable quote cache cannot establish which provider priced it.
        op.execute(sa.text(f"""
            UPDATE {table}
            SET simulated_quote_date = date(simulated_quote_at)
            WHERE simulated_quote_at IS NOT NULL
        """))


def downgrade() -> None:
    for table in ("trades", "orders"):
        op.drop_column(table, "simulated_quote_date")
        op.drop_column(table, "simulated_quote_source")
