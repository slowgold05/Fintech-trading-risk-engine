"""Preserve provider-reported fractional daily aggregate volume.

Revision ID: b7c91a0e4d62
Revises: a4c8e2b7d915
"""

from alembic import op
import sqlalchemy as sa

revision = "b7c91a0e4d62"
down_revision = "a4c8e2b7d915"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("market_bars_daily") as batch:
        batch.alter_column("volume", existing_type=sa.BigInteger(), type_=sa.Numeric(30, 6), existing_nullable=False)


def downgrade() -> None:
    if op.get_bind().scalar(sa.text(
        "SELECT COUNT(*) FROM market_bars_daily WHERE volume <> CAST(volume AS BIGINT) "
        "OR volume > 9223372036854775807"
    )):
        raise RuntimeError("Cannot downgrade market_bars_daily.volume without losing volume data")
    with op.batch_alter_table("market_bars_daily") as batch:
        batch.alter_column("volume", existing_type=sa.Numeric(30, 6), type_=sa.BigInteger(), existing_nullable=False)
