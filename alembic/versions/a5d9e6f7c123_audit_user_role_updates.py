"""Audit every database role update, including direct privileged updates.

Revision ID: a5d9e6f7c123
Revises: f4c8d5e6b012
"""

from alembic import op

revision = "a5d9e6f7c123"
down_revision = "f4c8d5e6b012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "mysql":
        op.execute("""
            CREATE TRIGGER users_role_audit AFTER UPDATE ON users FOR EACH ROW
            INSERT INTO role_changes (user_id, old_role, new_role, actor, reason, request_id)
            SELECT OLD.id, OLD.role, NEW.role,
                   COALESCE(@role_change_actor, CURRENT_USER()),
                   COALESCE(@role_change_reason, 'Direct database role update'),
                   @role_change_request_id
            WHERE OLD.role <> NEW.role
        """)
    elif dialect == "postgresql":
        op.execute("""
            CREATE FUNCTION audit_user_role_update() RETURNS trigger AS $$
            BEGIN
                IF OLD.role IS DISTINCT FROM NEW.role THEN
                    INSERT INTO role_changes (user_id, old_role, new_role, actor, reason, request_id)
                    VALUES (OLD.id, OLD.role, NEW.role,
                            COALESCE(NULLIF(current_setting('app.role_change_actor', true), ''), CURRENT_USER),
                            COALESCE(NULLIF(current_setting('app.role_change_reason', true), ''), 'Direct database role update'),
                            NULLIF(current_setting('app.role_change_request_id', true), '')::integer);
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        """)
        op.execute("CREATE TRIGGER users_role_audit AFTER UPDATE OF role ON users FOR EACH ROW EXECUTE FUNCTION audit_user_role_update()")
    else:
        raise NotImplementedError(f"Role audit trigger is not supported on {dialect}")


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "mysql":
        op.execute("DROP TRIGGER users_role_audit")
    elif dialect == "postgresql":
        op.execute("DROP TRIGGER users_role_audit ON users")
        op.execute("DROP FUNCTION audit_user_role_update()")
