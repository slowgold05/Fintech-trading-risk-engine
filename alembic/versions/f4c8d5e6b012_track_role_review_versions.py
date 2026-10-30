"""Track role-change versions in approvals and reviews.

Revision ID: f4c8d5e6b012
Revises: e3b7c4d5a901
"""

from alembic import op
import sqlalchemy as sa

revision = "f4c8d5e6b012"
down_revision = "e3b7c4d5a901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("role_change_requests", sa.Column("old_change_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_role_change_requests_old_change", "role_change_requests", "role_changes", ["old_change_id"], ["id"])
    op.add_column("access_reviews", sa.Column("observed_change_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_access_reviews_observed_change", "access_reviews", "role_changes", ["observed_change_id"], ["id"])


def downgrade() -> None:
    op.drop_constraint("fk_access_reviews_observed_change", "access_reviews", type_="foreignkey")
    op.drop_column("access_reviews", "observed_change_id")
    op.drop_constraint("fk_role_change_requests_old_change", "role_change_requests", type_="foreignkey")
    op.drop_column("role_change_requests", "old_change_id")
