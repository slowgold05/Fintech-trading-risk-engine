from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.aml import Incident
from app.models.user import User


NOTICE_DAYS = 30
REVIEW_ROLES = {"admin", "compliance_officer"}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _require_reviewer(user: User) -> None:
    if user.role not in REVIEW_ROLES:
        raise HTTPException(status_code=403, detail="A reviewer role is required")


def open_incident(db: Session, user: User, title: str, severity: str, summary: str,
                  discovered_at: datetime | None = None) -> Incident:
    _require_reviewer(user)
    if severity not in {"low", "moderate", "high"}:
        raise HTTPException(status_code=422, detail="Severity is invalid")
    discovered = discovered_at or _now()
    row = Incident(
        title=title.strip(), severity=severity, summary=summary.strip(),
        discovered_at=discovered, customer_notice_due_at=discovered + timedelta(days=NOTICE_DAYS),
        opened_by_user_id=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_incidents(db: Session) -> list[dict]:
    rows = db.execute(select(Incident).order_by(Incident.id.desc())).scalars().all()
    return [{
        "id": row.id, "title": row.title, "severity": row.severity, "status": row.status,
        "summary": row.summary, "discovered_at": row.discovered_at,
        "customer_notice_due_at": row.customer_notice_due_at,
        "customer_notified_at": row.customer_notified_at, "opened_by_user_id": row.opened_by_user_id,
        "closed_at": row.closed_at,
    } for row in rows]


def record_notice(db: Session, user: User, incident_id: int) -> Incident:
    _require_reviewer(user)
    row = db.execute(select(Incident).where(Incident.id == incident_id).with_for_update()).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    if row.opened_by_user_id == user.id:
        raise HTTPException(status_code=403, detail="The person who opened the incident cannot record the notice")
    if row.customer_notified_at is not None:
        raise HTTPException(status_code=409, detail="Customer notice is already recorded")
    row.customer_notified_at = _now()
    row.notified_by_user_id = user.id
    db.commit()
    db.refresh(row)
    return row


def close_incident(db: Session, user: User, incident_id: int) -> Incident:
    _require_reviewer(user)
    row = db.execute(select(Incident).where(Incident.id == incident_id).with_for_update()).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    if row.status != "open":
        raise HTTPException(status_code=409, detail="Incident is already closed")
    if row.opened_by_user_id == user.id:
        raise HTTPException(status_code=403, detail="The person who opened the incident cannot close it")
    if row.customer_notified_at is None:
        raise HTTPException(status_code=409, detail="Customer notice is required before close")
    row.status = "closed"
    row.closed_at = _now()
    row.closed_by_user_id = user.id
    db.commit()
    db.refresh(row)
    return row


def check_incident_notices(db: Session, now: datetime | None = None) -> dict:
    current = now or _now()
    rows = db.execute(select(Incident)).scalars().all()
    violations = []
    for row in rows:
        late_open = row.customer_notified_at is None and current > row.customer_notice_due_at
        late_notice = row.customer_notified_at is not None and row.customer_notified_at > row.customer_notice_due_at
        if late_open or late_notice:
            violations.append(row.id)
    return {"checked": len(rows), "violation_count": len(violations), "violation_ids": violations[:20]}
