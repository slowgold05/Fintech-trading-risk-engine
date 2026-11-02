"""Record append-only quarterly account access reviews.

Revision ID: e3b7c4d5a901
Revises: d2a6f9c4b781
"""

from alembic import op
import sqlalchemy as sa

revision = "e3b7c4d5a901"
down_revision = "d2a6f9c4b781"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "access_reviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("observed_role", sa.String(24), nullable=False),
        sa.Column("reviewer_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("decision", sa.String(10), nullable=False),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("decision IN ('retain', 'remove')", name="ck_access_reviews_decision"),
        sa.CheckConstraint("reviewer_user_id <> user_id", name="ck_access_reviews_no_self_review"),
    )
    op.create_index("ix_access_reviews_period_user", "access_reviews", ["period", "user_id"])
    dialect = op.get_bind().dialect.name
    if dialect == "mysql":
        for action in ("UPDATE", "DELETE"):
            op.execute(f"CREATE TRIGGER access_reviews_no_{action.lower()} BEFORE {action} ON access_reviews FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Access reviews are append-only'")
    elif dialect == "postgresql":
        op.execute("CREATE FUNCTION reject_access_review_edit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Access reviews are append-only'; END; $$ LANGUAGE plpgsql")
        op.execute("CREATE TRIGGER access_reviews_no_edit BEFORE UPDATE OR DELETE ON access_reviews FOR EACH ROW EXECUTE FUNCTION reject_access_review_edit()")
    else:
        raise NotImplementedError(f"Access review migration is not supported on {dialect}")


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "mysql":
        op.execute("DROP TRIGGER access_reviews_no_update")
        op.execute("DROP TRIGGER access_reviews_no_delete")
    elif dialect == "postgresql":
        op.execute("DROP TRIGGER access_reviews_no_edit ON access_reviews")
        op.execute("DROP FUNCTION reject_access_review_edit()")
    op.drop_index("ix_access_reviews_period_user", table_name="access_reviews")
    op.drop_table("access_reviews")
