"""Store control runs in an append-only table the API can read.

Revision ID: 1c4e8a7b2d90
Revises: c7e8f1a2b345
"""

from alembic import op
import sqlalchemy as sa


revision = "1c4e8a7b2d90"
down_revision = "c7e8f1a2b345"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "control_evidence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("control_id", sa.String(32), nullable=False),
        sa.Column("run_at", sa.DateTime(), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
    )
    op.create_index("ix_control_evidence_control_id", "control_evidence", ["control_id"])

    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute(
            "CREATE FUNCTION reject_control_evidence_edit() RETURNS trigger AS $$ "
            "BEGIN RAISE EXCEPTION 'Control evidence is append-only'; END; "
            "$$ LANGUAGE plpgsql"
        )
        op.execute(
            "CREATE TRIGGER control_evidence_no_edit BEFORE UPDATE OR DELETE ON control_evidence "
            "FOR EACH ROW EXECUTE FUNCTION reject_control_evidence_edit()"
        )
    elif dialect == "mysql":
        for action in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER control_evidence_no_{action.lower()} BEFORE {action} ON control_evidence "
                "FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Control evidence is append-only'"
            )
    else:
        raise NotImplementedError(f"Control evidence trigger is not supported on {dialect}")


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute("DROP TRIGGER control_evidence_no_edit ON control_evidence")
        op.execute("DROP FUNCTION reject_control_evidence_edit()")
    elif dialect == "mysql":
        op.execute("DROP TRIGGER control_evidence_no_update")
        op.execute("DROP TRIGGER control_evidence_no_delete")
    op.drop_index("ix_control_evidence_control_id", table_name="control_evidence")
    op.drop_table("control_evidence")
