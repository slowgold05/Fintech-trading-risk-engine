import argparse
import getpass
import json
from datetime import datetime, timezone

from sqlalchemy import create_engine, select, text
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.role_change import RoleChange
from app.models.role_change_request import RoleChangeRequest
from app.models.user import ROLES, User


def set_role(db: Session, email: str, role: str, actor: str, reason: str,
             request_id: int | None = None) -> RoleChange:
    actor, reason = actor.strip(), reason.strip()
    if role not in ROLES or not actor or not reason:
        raise ValueError("Valid role, actor, and reason are required")
    user = db.execute(select(User).where(User.email == email).with_for_update()).scalar_one_or_none()
    if user is None:
        raise ValueError("User not found")
    if user.role == role:
        raise ValueError("User already has that role")
    old_role = user.role
    dialect = db.get_bind().dialect.name
    if dialect == "mysql":
        db.execute(text("SET @role_change_actor = :actor"), {"actor": actor})
        db.execute(text("SET @role_change_reason = :reason"), {"reason": reason})
        db.execute(text("SET @role_change_request_id = :request_id"), {"request_id": request_id})
    elif dialect == "postgresql":
        db.execute(text("SELECT set_config('app.role_change_actor', :actor, true)"), {"actor": actor})
        db.execute(text("SELECT set_config('app.role_change_reason', :reason, true)"), {"reason": reason})
        db.execute(text("SELECT set_config('app.role_change_request_id', :request_id, true)"),
                   {"request_id": str(request_id) if request_id is not None else ""})
    try:
        user.role = role
        if dialect == "sqlite":
            change = RoleChange(user_id=user.id, old_role=old_role, new_role=role,
                                actor=actor, reason=reason, request_id=request_id)
            db.add(change)
            db.flush()
            return change
        db.flush()
        change = db.execute(select(RoleChange).where(RoleChange.user_id == user.id)
                            .order_by(RoleChange.id.desc()).limit(1)).scalar_one_or_none()
        if change is None or change.old_role != old_role or change.new_role != role or change.actor != actor or change.request_id != request_id:
            raise RuntimeError("Role audit trigger did not record the change")
        return change
    finally:
        if dialect == "mysql":
            db.execute(text("SET @role_change_actor = NULL, @role_change_reason = NULL, @role_change_request_id = NULL"))


def apply_request(db: Session, request_id: int, actor: str) -> RoleChange:
    item = db.execute(select(RoleChangeRequest).where(RoleChangeRequest.id == request_id).with_for_update()).scalar_one_or_none()
    if item is None or item.status != "approved" or item.approved_by_user_id is None:
        raise ValueError("Approved role request not found")
    if item.requested_by_user_id == item.approved_by_user_id:
        raise ValueError("Requester cannot approve their own role request")
    user = db.execute(select(User).where(User.id == item.target_user_id).with_for_update()).scalar_one()
    latest_change = db.execute(select(func.max(RoleChange.id)).where(RoleChange.user_id == user.id)).scalar_one()
    if user.role != item.old_role or latest_change != item.old_change_id:
        raise ValueError("Target role changed since approval")
    change = set_role(db, user.email, item.new_role, actor, item.reason, request_id=item.id)
    item.status = "applied"
    item.applied_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.flush()
    return change


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply an approved role request using the privileged migration login.")
    parser.add_argument("--request-id", type=int)
    parser.add_argument("--bootstrap", action="store_true", help="Seed the first admin or compliance officer")
    parser.add_argument("--email")
    parser.add_argument("--role", choices=ROLES)
    parser.add_argument("--reason")
    parser.add_argument("--actor", default=getpass.getuser())
    args = parser.parse_args()
    if args.bootstrap == (args.request_id is not None):
        parser.error("Specify either --request-id or --bootstrap")
    if args.bootstrap and (not args.email or args.role not in {"admin", "compliance_officer"} or not args.reason):
        parser.error("Bootstrap requires --email, --role admin/compliance_officer, and --reason")
    if not settings.migration_database_url:
        raise SystemExit("MIGRATION_DATABASE_URL is required to change user roles")
    engine = create_engine(settings.migration_database_url)
    with Session(engine) as db:
        try:
            if args.bootstrap:
                if db.execute(select(User.id).where(User.role == args.role)).first():
                    raise ValueError("A user already holds this role; use an approved request")
                change = set_role(db, args.email, args.role, args.actor, args.reason)
            else:
                change = apply_request(db, args.request_id, args.actor)
            db.commit()
            print(json.dumps({"change_id": change.id, "user_id": change.user_id,
                              "old_role": change.old_role, "new_role": change.new_role,
                              "actor": change.actor}, sort_keys=True))
        except ValueError as exc:
            db.rollback()
            raise SystemExit(str(exc)) from exc
    engine.dispose()


if __name__ == "__main__":
    main()
