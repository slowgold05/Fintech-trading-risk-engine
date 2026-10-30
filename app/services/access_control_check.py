from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session


PROBES = (
    ("users.role", "UPDATE users SET role=role WHERE 1=0"),
    ("role_changes.reason", "UPDATE role_changes SET reason=reason WHERE 1=0"),
    ("role_change_requests.target_user_id", "UPDATE role_change_requests SET target_user_id=target_user_id WHERE 1=0"),
    ("access_reviews.reason", "UPDATE access_reviews SET reason=reason WHERE 1=0"),
)


def check_app_role_grants(db: Session) -> dict:
    violations = []
    for name, sql in PROBES:
        try:
            db.execute(text(sql))
        except DBAPIError as exc:
            db.rollback()
            codes = {getattr(exc.orig, "sqlstate", None), getattr(exc.orig, "pgcode", None),
                     getattr(exc.orig, "args", [None])[0]}
            if not codes.intersection({1142, 1143, "42501"}):
                raise
        else:
            db.rollback()
            violations.append(name)
    return {"checked": len(PROBES), "violation_count": len(violations), "violations": violations}
