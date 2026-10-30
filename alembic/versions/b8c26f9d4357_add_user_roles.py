"""Add user roles for separation of duties.

Revision ID: b8c26f9d4357
Revises: a7b15e8c3246
"""

from alembic import op
import sqlalchemy as sa

revision = "b8c26f9d4357"
down_revision = "a7b15e8c3246"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("role", sa.String(24), nullable=False, server_default="trader"))
    op.create_check_constraint("ck_users_role_valid", "users", "role IN ('trader', 'analyst', 'compliance_officer', 'admin', 'auditor')")
    op.create_table(
        "role_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("old_role", sa.String(24), nullable=False),
        sa.Column("new_role", sa.String(24), nullable=False),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("changed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_role_changes_user_id", "role_changes", ["user_id"])
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute("CREATE FUNCTION reject_role_change_edit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Role change records are append-only'; END; $$ LANGUAGE plpgsql")
        op.execute("CREATE TRIGGER role_changes_no_edit BEFORE UPDATE OR DELETE ON role_changes FOR EACH ROW EXECUTE FUNCTION reject_role_change_edit()")
    elif dialect == "mysql":
        for action in ("UPDATE", "DELETE"):
            op.execute(f"CREATE TRIGGER role_changes_no_{action.lower()} BEFORE {action} ON role_changes FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Role change records are append-only'")
    else:
        raise NotImplementedError(f"Role audit migration is not supported on {dialect}")


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute("DROP TRIGGER role_changes_no_edit ON role_changes")
        op.execute("DROP FUNCTION reject_role_change_edit()")
    elif dialect == "mysql":
        op.execute("DROP TRIGGER role_changes_no_update")
        op.execute("DROP TRIGGER role_changes_no_delete")
    op.drop_index("ix_role_changes_user_id", table_name="role_changes")
    op.drop_table("role_changes")
    op.drop_constraint("ck_users_role_valid", "users", type_="check")
    op.drop_column("users", "role")
