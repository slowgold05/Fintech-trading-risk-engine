import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.order import Order
from app.models.surveillance import SurveillanceActivation, SurveillanceCase
from app.models.trade import Trade
from app.models.user import User
from app.services.case_events import unreviewed_group
from app.services.detection_cursor import SURVEILLANCE, commit_scan
from app.services.surveillance_detect import Detection, SurveillanceEvent, detect
from app.services.surveillance_rules import load_rules


REVIEW_ROLES = {"admin", "compliance_officer"}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _require_reviewer(user: User) -> None:
    if user.role not in REVIEW_ROLES:
        raise HTTPException(status_code=403, detail="A reviewer role is required")


def list_rule_states(db: Session) -> list[dict]:
    rows = db.execute(select(SurveillanceActivation).order_by(SurveillanceActivation.id.desc())).scalars().all()
    latest: dict[str, SurveillanceActivation] = {}
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
    rows = db.execute(select(SurveillanceCase).order_by(SurveillanceCase.id.desc())).scalars().all()
    return [{
        "id": row.id,
        "rule_id": row.rule_id,
        "rule_version": row.rule_version,
        "subject_user_id": row.subject_user_id,
        "symbol": row.symbol,
        "status": row.status,
        "disposition": row.disposition,
        "summary": row.summary,
        "opened_at": row.opened_at,
        "due_at": row.due_at,
        "closed_at": row.closed_at,
    } for row in rows]


def active_rules(db: Session) -> list[dict]:
    rows = db.execute(select(SurveillanceActivation).where(SurveillanceActivation.status == "active")).scalars()
    catalog = load_rules()
    active = []
    for row in rows:
        rule = catalog.get(row.rule_id)
        if rule and rule["version"] == row.version:
            active.append(rule)
    return active


def request_activation(db: Session, user: User, rule_id: str, reason: str) -> SurveillanceActivation:
    _require_reviewer(user)
    rule = load_rules().get(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Surveillance rule not found")
    if not reason.strip():
        raise HTTPException(status_code=422, detail="Activation reason is required")
    pending = db.execute(select(SurveillanceActivation).where(
        SurveillanceActivation.rule_id == rule_id, SurveillanceActivation.status == "pending")).scalar_one_or_none()
    if pending is not None:
        raise HTTPException(status_code=409, detail="This rule already has a pending activation")
    row = SurveillanceActivation(rule_id=rule_id, version=rule["version"], reason=reason.strip(),
                                 requested_by_user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def decide_activation(db: Session, user: User, request_id: int, approve: bool) -> SurveillanceActivation:
    _require_reviewer(user)
    row = db.execute(select(SurveillanceActivation).where(SurveillanceActivation.id == request_id)
                     .with_for_update()).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Activation request not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="Activation request is no longer pending")
    if row.requested_by_user_id == user.id:
        raise HTTPException(status_code=403, detail="The requester cannot approve or reject this rule")
    current = load_rules().get(row.rule_id)
    if approve and (current is None or current["version"] != row.version):
        raise HTTPException(status_code=409, detail="Rule version changed since the request")
    if approve:
        for previous in db.execute(select(SurveillanceActivation).where(
                SurveillanceActivation.rule_id == row.rule_id, SurveillanceActivation.status == "active")).scalars():
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
    cases = db.execute(select(SurveillanceCase)).scalars().all()
    breached = []
    for case in cases:
        ended = case.closed_at if case.status == "closed" else current
        if ended is not None and ended > case.due_at:
            breached.append(case.id)
    return {"checked": len(cases), "violation_count": len(breached), "breached_case_ids": breached[:20]}


def _lookback_minutes(rules: list[dict]) -> int:
    minutes = 60
    for rule in rules:
        parameters = rule["parameters"]
        for name in ("window_minutes", "rise_minutes", "dump_minutes"):
            if name in parameters:
                minutes = max(minutes, int(parameters[name]))
        if "rise_minutes" in parameters and "dump_minutes" in parameters:
            minutes = max(minutes, int(parameters["rise_minutes"]) + int(parameters["dump_minutes"]))
    return minutes


def events_from_db(db: Session, since: datetime) -> list[SurveillanceEvent]:
    events = []
    trades = db.execute(select(Trade, Asset.symbol).join(Asset, Trade.asset_id == Asset.id)
                        .where(Trade.executed_at >= since)).all()
    for trade, symbol in trades:
        events.append(SurveillanceEvent(
            f"trade-{trade.id}", trade.executed_at, trade.user_id, symbol, "trade", trade.side,
            trade.quantity, trade.price_at_execution, str(trade.order_id) if trade.order_id else None,
        ))
    orders = db.execute(select(Order, Asset.symbol).join(Asset, Order.asset_id == Asset.id).where(
        or_(Order.created_at >= since, and_(Order.canceled_at.is_not(None), Order.canceled_at >= since)))).all()
    for order, symbol in orders:
        if order.created_at >= since:
            events.append(SurveillanceEvent(
                f"order-{order.id}", order.created_at, order.user_id, symbol, "order", order.side,
                order.quantity, order.limit_price or 0, str(order.id),
            ))
        if order.canceled_at is not None and order.canceled_at >= since:
            events.append(SurveillanceEvent(
                f"cancel-{order.id}", order.canceled_at, order.user_id, symbol, "cancel", order.side,
                order.quantity, order.limit_price or 0, str(order.id),
            ))
    return events


def open_cases(db: Session, detections: list[Detection], rules: dict[str, dict], now: datetime | None = None) -> int:
    current = now or _now()
    grouped: dict[tuple[str, int, str], list[Detection]] = {}
    for item in detections:
        grouped.setdefault((item.rule_id, item.user_id, item.symbol), []).append(item)
    opened = 0
    for (rule_id, user_id, symbol), items in grouped.items():
        rule = rules[rule_id]
        prior = db.execute(select(SurveillanceCase).where(
            SurveillanceCase.rule_id == rule_id, SurveillanceCase.subject_user_id == user_id,
            SurveillanceCase.symbol == symbol, SurveillanceCase.rule_version == rule["version"],
        )).scalars().all()
        fresh = unreviewed_group(items, prior, rule["version"])
        if fresh is None:
            continue
        chosen, stored = fresh
        db.add(SurveillanceCase(
            rule_id=rule_id, rule_version=rule["version"], subject_user_id=user_id, symbol=symbol,
            event_ids=json.dumps(stored),
            summary=chosen.summary[:255], due_at=current + timedelta(hours=rule["sla_hours"]), opened_at=current,
        ))
        opened += 1
    db.flush()
    return opened


def run_live_surveillance(db: Session, now: datetime | None = None) -> dict:
    current = now or _now()
    rules = active_rules(db)
    if not rules:
        return {"opened": 0, "rules": 0}
    overlap = timedelta(minutes=_lookback_minutes(rules))

    def work(since: datetime) -> tuple[int, int]:
        events = events_from_db(db, since)
        detections = []
        catalog = {rule["id"]: rule for rule in rules}
        for rule in rules:
            detections.extend(detect(rule, events))
        return open_cases(db, detections, catalog, current), len(rules)

    return commit_scan(db, SURVEILLANCE, current, overlap, work)


def close_case(db: Session, user: User, case_id: int, disposition: str, reason: str) -> SurveillanceCase:
    _require_reviewer(user)
    if disposition not in {"true_positive", "false_positive", "inconclusive"}:
        raise HTTPException(status_code=422, detail="Disposition is invalid")
    if not reason.strip():
        raise HTTPException(status_code=422, detail="Close reason is required")
    case = db.execute(select(SurveillanceCase).where(SurveillanceCase.id == case_id).with_for_update()).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Surveillance case not found")
    if case.status != "open":
        raise HTTPException(status_code=409, detail="Surveillance case is already closed")
    if case.subject_user_id == user.id:
        raise HTTPException(status_code=403, detail="A reviewer cannot close a case on their own trading")
    case.status = "closed"
    case.disposition = disposition
    case.close_reason = reason.strip()
    case.closed_at = _now()
    case.closed_by_user_id = user.id
    db.commit()
    db.refresh(case)
    return case
