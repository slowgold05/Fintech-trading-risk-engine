from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session


DENIED_CODES = {1142, 1143, "42501"}
PROBES = (
    ("users.role", "UPDATE users SET role=role WHERE 1=0"),
    ("role_changes.reason", "UPDATE role_changes SET reason=reason WHERE 1=0"),
    ("role_change_requests.target_user_id", "UPDATE role_change_requests SET target_user_id=target_user_id WHERE 1=0"),
    ("access_reviews.reason", "UPDATE access_reviews SET reason=reason WHERE 1=0"),
    ("trading_halt_events.reason", "UPDATE trading_halt_events SET reason=reason WHERE 1=0"),
)
EVIDENCE_PROBES = (
    ("control_evidence.update", "UPDATE control_evidence SET sha256=sha256 WHERE 1=0"),
    ("control_evidence.delete", "DELETE FROM control_evidence WHERE 1=0"),
)


def privilege_denials(db: Session, probes: tuple[tuple[str, str], ...], denied_codes: set) -> dict:
    violations = []
    for name, sql in probes:
        try:
            db.execute(text(sql))
        except DBAPIError as exc:
            db.rollback()
            codes = {getattr(exc.orig, "sqlstate", None), getattr(exc.orig, "pgcode", None),
                     getattr(exc.orig, "args", [None])[0]}
            if not codes.intersection(denied_codes):
                raise
        else:
            db.rollback()
            violations.append(name)
    return {"checked": len(probes), "violation_count": len(violations), "violations": violations}


def check_app_role_grants(db: Session) -> dict:
    return privilege_denials(db, PROBES, DENIED_CODES)


def check_evidence_immutable(db: Session) -> dict:
    return privilege_denials(db, EVIDENCE_PROBES, DENIED_CODES | {"P0001"})
