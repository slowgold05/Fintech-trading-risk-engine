import json

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.role_change import RoleChange
from app.models.user import User
from app.services.control_evidence import control_status, write_evidence


def check_role_audit(db: Session) -> dict:
    user = db.execute(select(User).order_by(User.id).limit(1)).scalar_one_or_none()
    if user is None:
        return {"checked": 0, "violation_count": 0, "violations": []}
    old_role = user.role
    new_role = "analyst" if old_role != "analyst" else "trader"
    before = db.execute(select(func.count()).select_from(RoleChange)
                        .where(RoleChange.user_id == user.id)).scalar_one()
    try:
        db.execute(text("UPDATE users SET role=:role WHERE id=:id"), {"role": new_role, "id": user.id})
        latest = db.execute(select(RoleChange).where(RoleChange.user_id == user.id)
                            .order_by(RoleChange.id.desc()).limit(1)).scalar_one_or_none()
        after = db.execute(select(func.count()).select_from(RoleChange)
                           .where(RoleChange.user_id == user.id)).scalar_one()
        audited = (latest is not None and after == before + 1 and latest.old_role == old_role
                   and latest.new_role == new_role and latest.reason == "Direct database role update"
                   and latest.request_id is None)
        return {"checked": 1, "violation_count": 0 if audited else 1,
                "violations": [] if audited else ["Direct role update lacked an audit row"]}
    except DBAPIError:
        return {"checked": 1, "violation_count": 1,
                "violations": ["Direct role update probe could not complete"]}
    finally:
        db.rollback()


def main() -> None:
    if not settings.migration_database_url:
        raise SystemExit("MIGRATION_DATABASE_URL is required for the role audit control")
    engine = create_engine(settings.migration_database_url)
    with Session(engine) as db:
        result = check_role_audit(db)
    engine.dispose()
    path, digest = write_evidence("SM-AC-02", result)
    status = control_status("SM-AC-02", result)
    print(json.dumps({"control_id": "SM-AC-02", "status": status,
                      "evidence": str(path), "sha256": digest}, sort_keys=True))
    if status == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
