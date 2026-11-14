import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.aml import AmlActivation, AmlCase, CashMovement
from app.models.user import User
from app.services.aml_detect import CashEvent, Detection, detect
from app.services.aml_rules import int_param, load_rules
from app.services.case_events import display_event_ids, unreviewed_group
from app.services.detection_cursor import AML, commit_scan


REVIEW_ROLES = {"admin", "compliance_officer"}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _require_reviewer(user: User) -> None:
    if user.role not in REVIEW_ROLES:
        raise HTTPException(status_code=403, detail="A reviewer role is required")


def list_rule_states(db: Session) -> list[dict]:
    rows = db.execute(select(AmlActivation).order_by(AmlActivation.id.desc())).scalars().all()
    latest: dict[str, AmlActivation] = {}
    for row in rows:
        latest.setdefault(row.rule_id, row)
    items = []
    for rule in load_rules().values():
        row = latest.get(rule["id"])
        items.append({
            "id": rule["id"],
            "title": rule["title"],
            "version": rule["version"],
            "model_type": rule["model_type"],
            "sla_hours": rule["sla_hours"],
            "activation_status": row.status if row is not None else "inactive",
            "request_id": row.id if row is not None and row.status == "pending" else None,
            "requested_by_user_id": row.requested_by_user_id if row is not None else None,
        })
    return items


def list_cases(db: Session) -> list[dict]:
    rows = db.execute(select(AmlCase).order_by(AmlCase.id.desc())).scalars().all()
    return [{
        "id": row.id,
        "rule_id": row.rule_id,
        "rule_version": row.rule_version,
        "subject_user_id": row.subject_user_id,
        "status": row.status,
        "disposition": row.disposition,
        "summary": row.summary,
        "event_ids": display_event_ids(json.loads(row.event_ids)),
        "opened_at": row.opened_at,
        "due_at": row.due_at,
        "closed_at": row.closed_at,
    } for row in rows]


def active_rules(db: Session) -> list[dict]:
    catalog = load_rules()
    active = []
    for row in db.execute(select(AmlActivation).where(AmlActivation.status == "active")).scalars():
        rule = catalog.get(row.rule_id)
        if rule and rule["version"] == row.version:
            active.append(rule)
    return active


def request_activation(db: Session, user: User, rule_id: str, reason: str) -> AmlActivation:
    _require_reviewer(user)
    rule = load_rules().get(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="AML rule not found")
    if not reason.strip():
        raise HTTPException(status_code=422, detail="Activation reason is required")
    pending = db.execute(select(AmlActivation).where(
        AmlActivation.rule_id == rule_id, AmlActivation.status == "pending")).scalar_one_or_none()
    if pending is not None:
        raise HTTPException(status_code=409, detail="This rule already has a pending activation")
    row = AmlActivation(rule_id=rule_id, version=rule["version"], reason=reason.strip(), requested_by_user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def decide_activation(db: Session, user: User, request_id: int, approve: bool) -> AmlActivation:
    _require_reviewer(user)
    row = db.execute(select(AmlActivation).where(AmlActivation.id == request_id).with_for_update()).scalar_one_or_none()
    if row is None or row.status != "pending":
        raise HTTPException(status_code=404, detail="Pending AML activation not found")
    if row.requested_by_user_id == user.id:
        raise HTTPException(status_code=403, detail="The requester cannot decide this activation")
    rule = load_rules().get(row.rule_id)
    if approve and (rule is None or rule["version"] != row.version):
        raise HTTPException(status_code=409, detail="The rule version changed after the request")
    if approve:
        for previous in db.execute(select(AmlActivation).where(
                AmlActivation.rule_id == row.rule_id, AmlActivation.status == "active")).scalars():
            previous.status = "retired"
        row.status = "active"
    else:
        row.status = "rejected"
    row.approved_by_user_id = user.id
    row.approved_at = _now()
    db.commit()
    db.refresh(row)
    return row


def check_case_sla(db: Session, now: datetime | None = None) -> dict:
    current = now or _now()
    cases = db.execute(select(AmlCase)).scalars().all()
    breached = [case.id for case in cases if (case.closed_at if case.status == "closed" else current) > case.due_at]
    return {"checked": len(cases), "violation_count": len(breached), "breached_case_ids": breached[:20]}


def _lookback(rules: list[dict]) -> timedelta:
    span = timedelta(minutes=60)
    for rule in rules:
        if "window_hours" in rule["parameters"]:
            span = max(span, timedelta(hours=int_param(rule, "window_hours")))
        if "window_minutes" in rule["parameters"]:
            span = max(span, timedelta(minutes=int_param(rule, "window_minutes")))
    return span


def events_from_db(db: Session, since: datetime) -> list[CashEvent]:
    rows = db.execute(select(CashMovement).where(CashMovement.created_at >= since)).scalars()
    return [CashEvent(f"cash-{row.id}", row.created_at, row.user_id, row.kind, row.amount) for row in rows]


def open_cases(db: Session, detections: list[Detection], rules: dict[str, dict], now: datetime | None = None) -> int:
    current = now or _now()
    grouped: dict[tuple[str, int], list[Detection]] = {}
    for item in detections:
        grouped.setdefault((item.rule_id, item.user_id), []).append(item)
    opened = 0
    for (rule_id, user_id), items in grouped.items():
        rule = rules[rule_id]
        prior = db.execute(select(AmlCase).where(
            AmlCase.rule_id == rule_id, AmlCase.subject_user_id == user_id,
            AmlCase.rule_version == rule["version"],
        )).scalars().all()
        fresh = unreviewed_group(items, prior, rule["version"])
        if fresh is None:
            continue
        chosen, stored = fresh
        db.add(AmlCase(
            rule_id=rule_id, rule_version=rule["version"], subject_user_id=user_id,
            event_ids=json.dumps(stored),
            summary=chosen.summary[:255], due_at=current + timedelta(hours=rule["sla_hours"]), opened_at=current,
        ))
        opened += 1
    db.flush()
    return opened


def run_live_aml(db: Session, now: datetime | None = None) -> dict:
    current = now or _now()
    rules = active_rules(db)
    overlap = _lookback(rules) if rules else timedelta(0)

    def work(since: datetime) -> tuple[int, int]:
        if not rules:
            return 0, 0
        events = events_from_db(db, since)
        detections = []
        catalog = {rule["id"]: rule for rule in rules}
        for rule in rules:
            detections.extend(detect(rule, events))
        return open_cases(db, detections, catalog, current), len(rules)

    return commit_scan(db, AML, current, overlap, work)


def close_case(db: Session, user: User, case_id: int, disposition: str, reason: str) -> AmlCase:
    _require_reviewer(user)
    if disposition not in {"true_positive", "false_positive", "inconclusive"}:
        raise HTTPException(status_code=422, detail="Disposition is invalid")
    if not reason.strip():
        raise HTTPException(status_code=422, detail="Close reason is required")
    case = db.execute(select(AmlCase).where(AmlCase.id == case_id).with_for_update()).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="AML case not found")
    if case.status != "open":
        raise HTTPException(status_code=409, detail="AML case is already closed")
    if case.subject_user_id == user.id:
        raise HTTPException(status_code=403, detail="A reviewer cannot close a case on their own cash activity")
    case.status = "closed"
    case.disposition = disposition
    case.close_reason = reason.strip()
    case.closed_at = _now()
    case.closed_by_user_id = user.id
    db.commit()
    db.refresh(case)
    return case
