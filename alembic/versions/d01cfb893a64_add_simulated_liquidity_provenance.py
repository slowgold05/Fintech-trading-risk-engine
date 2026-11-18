"""Store simulated execution provenance and the order remainder explanation."""

from alembic import op
import sqlalchemy as sa

revision = "d01cfb893a64"
down_revision = "b7c91a0e4d62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("simulated_quote_at", sa.DateTime(), nullable=True))
    op.add_column("orders", sa.Column("remainder_reason", sa.String(255), nullable=True))
    op.add_column("trades", sa.Column("simulated_quote_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("trades", "simulated_quote_at")
    op.drop_column("orders", "remainder_reason")
    op.drop_column("orders", "simulated_quote_at")
