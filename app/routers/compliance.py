import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response as FastAPIResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session
import yaml

from app.core.database import get_db
from app.core.config import settings
from app.core.security import get_current_compliance_user
from app.models.role_change import RoleChange
from app.models.role_change_request import RoleChangeRequest
from app.models.access_review import AccessReview
from app.models.user import User
from app.models.trading_halt import TradingHaltState, TradingHaltEvent
from app.services.access_review_check import current_review_period
from app.services.control_evidence import EVIDENCE_DIR, describe_payload, latest_database_evidence
from app.services.aml_cases import (
    close_case as close_aml_case,
    decide_activation as decide_aml_activation,
    list_cases as list_aml_cases,
    list_rule_states as list_aml_rules,
    request_activation as request_aml_activation,
    run_live_aml,
)
from app.services.incidents import close_incident, list_incidents, open_incident, record_notice
from app.services.audit_bundle import build_evidence_zip
from app.services.kri import kri_values
from app.services.findings import list_findings
from app.services.risk_brief import latest_brief
from app.services.sar_draft import create_draft
from app.services.trade_intents import approve_intent, compose_rationale, list_intents, propose_intent
from app.services.surveillance_cases import (
    close_case, decide_activation, list_cases, list_rule_states, request_activation, run_live_surveillance,
)


router = APIRouter(dependencies=[Depends(get_current_compliance_user)])
CONTROL_DIR = Path(__file__).resolve().parents[2] / "grc/controls"
RISK_REGISTER = Path(__file__).resolve().parents[2] / "grc/risk_register.yaml"


class RoleRequestCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    role: str = Field(min_length=3, max_length=24)
    reason: str = Field(min_length=3, max_length=255)


class AccessReviewCreate(BaseModel):
    user_id: int = Field(gt=0)
    decision: Literal["retain", "remove"]
    reason: str = Field(min_length=3, max_length=255)


class SurveillanceRequestCreate(BaseModel):
    reason: str = Field(min_length=3, max_length=255)


class SurveillanceCaseClose(BaseModel):
    disposition: Literal["true_positive", "false_positive", "inconclusive"]
    reason: str = Field(min_length=3, max_length=255)


class TradingHaltCreate(BaseModel):
    halted: bool
    reason: str = Field(min_length=3, max_length=255)


@router.get("/trading-halt")
def get_trading_halt(db: Session = Depends(get_db)):
    state = db.get(TradingHaltState, 1)
    if state is None:
        raise HTTPException(status_code=503, detail="Trading halt state unavailable")
    return {"halted": state.halted or settings.trading_halted, "operator_halted": state.halted,
            "emergency_override": settings.trading_halted, "actor_user_id": state.actor_user_id,
            "reason": state.reason, "changed_at": state.changed_at}


@router.put("/trading-halt")
def set_trading_halt(payload: TradingHaltCreate, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_compliance_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required to change trading halt")
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail="Trading halt reason is required")
    state = db.execute(select(TradingHaltState).where(TradingHaltState.id == 1)
                       .with_for_update().execution_options(populate_existing=True)).scalar_one_or_none()
    if state is None:
        raise HTTPException(status_code=503, detail="Trading halt state unavailable")
    if state.halted == payload.halted:
        raise HTTPException(status_code=409, detail="Trading halt is already in that state")
    state.halted = payload.halted
    state.actor_user_id = current_user.id
    state.reason = payload.reason.strip()
    state.changed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return get_trading_halt(db)


@router.get("/trading-halt/events")
def list_trading_halt_events(limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)):
    rows = db.execute(select(TradingHaltEvent).order_by(TradingHaltEvent.id.desc()).limit(limit)).scalars()
    return {"events": [{"id": row.id, "previous_halted": row.previous_halted, "halted": row.halted,
                        "actor_user_id": row.actor_user_id, "reason": row.reason, "changed_at": row.changed_at}
                       for row in rows]}


def latest_role_change_id(db: Session, user_id: int) -> int | None:
    return db.execute(select(func.max(RoleChange.id)).where(RoleChange.user_id == user_id)).scalar_one()


def evidence_table_ready(db: Session) -> bool:
    try:
        latest_database_evidence(db, "")
    except (ProgrammingError, OperationalError):
        db.rollback()
        return False
    return True


def file_evidence(control_id: str) -> dict | None:
    files = (EVIDENCE_DIR / control_id).glob("*.json")
    latest = max(files, key=lambda path: path.stat().st_mtime, default=None)
    if latest is None:
        return None
    try:
        return describe_payload(control_id, latest.read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return {"status": "evidence_error", "run_at": None, "checked": None, "sha256": None}


@router.get("/controls")
def list_controls(db: Session = Depends(get_db)):
    database_ready = evidence_table_ready(db)
    controls = []
    for definition in sorted(CONTROL_DIR.glob("*.yaml")):
        control = yaml.safe_load(definition.read_text(encoding="utf-8"))
        control_id = control["id"]
        item = {"id": control_id, "title": control["title"], "owner": control["owner"],
                "frequency": control["frequency"], "status": "not_run", "run_at": None,
                "checked": None, "sha256": None}
        evidence = latest_database_evidence(db, control_id) if database_ready else None
        if evidence is None:
            evidence = file_evidence(control_id)
        if evidence is not None:
            item.update(evidence)
        controls.append(item)
    return {"controls": controls}


@router.get("/risks")
def list_risks(db: Session = Depends(get_db)):
    register = yaml.safe_load(RISK_REGISTER.read_text(encoding="utf-8"))
    controls = {item["id"]: item for item in list_controls(db)["controls"]}
    current_time = datetime.now(timezone.utc)
    ratings = {"high": "moderate", "moderate": "low", "low": "low"}

    def recent_pass(item: dict | None) -> bool:
        if not item or item["status"] != "pass" or not item["run_at"]:
            return False
        try:
            run_at = datetime.fromisoformat(item["run_at"])
            return run_at.tzinfo is not None and current_time - timedelta(hours=36) <= run_at <= current_time
        except (ValueError, TypeError):
            return False

    risks = []
    for risk in register["risks"]:
        linked = [controls.get(control_id) for control_id in risk["controls"]]
        effective = bool(linked) and all(recent_pass(item) for item in linked)
        failed = any(item and item["status"] in {"fail", "evidence_error"} for item in linked)
        risks.append({**risk, "control_health": "effective" if effective else "failed" if failed else "unverified",
                      "residual_rating": ratings[risk["inherent_rating"]] if effective else risk["inherent_rating"]})
    return {"method": register["method"], "risks": risks}


@router.get("/role-changes")
def list_role_changes(limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)):
    rows = db.execute(
        select(RoleChange, User.email).join(User, RoleChange.user_id == User.id)
        .order_by(RoleChange.id.desc()).limit(limit)
    ).all()
    return {"changes": [
        {"id": change.id, "user_id": change.user_id, "email": email,
         "old_role": change.old_role, "new_role": change.new_role,
         "actor": change.actor, "reason": change.reason, "changed_at": change.changed_at}
        for change, email in rows
    ]}


@router.get("/role-requests")
def list_role_requests(limit: int = Query(default=50, ge=1, le=100), db: Session = Depends(get_db)):
    rows = db.execute(
        select(RoleChangeRequest, User.email).join(User, RoleChangeRequest.target_user_id == User.id)
        .order_by(RoleChangeRequest.id.desc()).limit(limit)
    ).all()
    return {"requests": [
        {"id": item.id, "email": email, "old_role": item.old_role, "new_role": item.new_role,
         "reason": item.reason, "requested_by_user_id": item.requested_by_user_id,
         "approved_by_user_id": item.approved_by_user_id, "status": item.status,
         "requested_at": item.requested_at, "approved_at": item.approved_at, "applied_at": item.applied_at}
        for item, email in rows
    ]}


@router.post("/role-requests")
def request_role_change(payload: RoleRequestCreate, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_compliance_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required to request a role change")
    from app.models.user import ROLES
    if payload.role not in ROLES or not payload.reason.strip():
        raise HTTPException(status_code=422, detail="Valid role and reason are required")
    target = db.execute(select(User).where(User.email == payload.email.strip().lower()).with_for_update()).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role == payload.role:
        raise HTTPException(status_code=409, detail="User already has that role")
    item = RoleChangeRequest(target_user_id=target.id, old_role=target.role, new_role=payload.role,
                             old_change_id=latest_role_change_id(db, target.id),
                             reason=payload.reason.strip(), requested_by_user_id=current_user.id)
    db.add(item)
    db.commit()
    return {"id": item.id, "status": item.status}


@router.post("/role-requests/{request_id}/approve")
def approve_role_change(request_id: int, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_compliance_user)):
    if current_user.role != "compliance_officer":
        raise HTTPException(status_code=403, detail="Compliance officer role required to approve a role change")
    item = db.execute(select(RoleChangeRequest).where(RoleChangeRequest.id == request_id).with_for_update()).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Role request not found")
    if item.status != "pending" or item.requested_by_user_id == current_user.id:
        raise HTTPException(status_code=409, detail="Role request cannot be approved")
    target = db.execute(select(User).where(User.id == item.target_user_id).with_for_update()).scalar_one()
    if target.role != item.old_role or latest_role_change_id(db, target.id) != item.old_change_id:
        raise HTTPException(status_code=409, detail="Target role changed since request")
    item.status = "approved"
    item.approved_by_user_id = current_user.id
    item.approved_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return {"id": item.id, "status": item.status}


@router.get("/access-review")
def list_access_review(period: str | None = Query(default=None, pattern=r"^\d{4}-Q[1-4]$"),
                       db: Session = Depends(get_db)):
    period = period or current_review_period()
    reviews = db.execute(select(AccessReview).where(AccessReview.period == period)
                         .order_by(AccessReview.id.desc())).scalars().all()
    latest = {review.user_id: review for review in reversed(reviews)}
    role_versions = dict(db.execute(select(RoleChange.user_id, func.max(RoleChange.id))
                                    .group_by(RoleChange.user_id)).all())
    users = db.execute(select(User).order_by(User.id)).scalars().all()
    return {"period": period, "accounts": [
        {"user_id": user.id, "email": user.email, "role": user.role,
         "status": "unreviewed" if user.id not in latest or latest[user.id].observed_role != user.role
         or latest[user.id].observed_change_id != role_versions.get(user.id)
         else latest[user.id].decision,
         "reviewer_user_id": latest[user.id].reviewer_user_id if user.id in latest else None,
         "reviewed_at": latest[user.id].reviewed_at if user.id in latest else None}
        for user in users
    ]}


@router.post("/access-review")
def submit_access_review(payload: AccessReviewCreate, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_compliance_user)):
    if current_user.role not in {"admin", "compliance_officer"}:
        raise HTTPException(status_code=403, detail="Reviewer role required")
    if payload.user_id == current_user.id:
        raise HTTPException(status_code=403, detail="Users cannot review their own access")
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail="Review reason is required")
    user = db.execute(select(User).where(User.id == payload.user_id).with_for_update()).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    period = current_review_period()
    previous = db.execute(select(AccessReview).where(AccessReview.period == period,
                                                     AccessReview.user_id == user.id)
                          .order_by(AccessReview.id.desc()).limit(1)).scalar_one_or_none()
    role_change_id = latest_role_change_id(db, user.id)
    if previous is not None and previous.observed_role == user.role and previous.observed_change_id == role_change_id:
        raise HTTPException(status_code=409, detail="This role has already been reviewed this quarter")
    review = AccessReview(period=period, user_id=user.id, observed_role=user.role,
                          observed_change_id=role_change_id,
                          reviewer_user_id=current_user.id, decision=payload.decision,
                          reason=payload.reason.strip())
    db.add(review)
    db.commit()
    return {"id": review.id, "period": period, "decision": review.decision}


def _reviewer(current_user: User) -> None:
    if current_user.role not in {"admin", "compliance_officer"}:
        raise HTTPException(status_code=403, detail="A reviewer role is required")


@router.get("/surveillance/rules")
def list_surveillance_rules(db: Session = Depends(get_db)):
    return {"rules": list_rule_states(db)}


@router.post("/surveillance/rules/{rule_id}/request")
def request_surveillance_rule(rule_id: str, payload: SurveillanceRequestCreate, db: Session = Depends(get_db),
                              current_user: User = Depends(get_current_compliance_user)):
    row = request_activation(db, current_user, rule_id, payload.reason)
    return {"id": row.id, "rule_id": row.rule_id, "version": row.version, "status": row.status}


@router.post("/surveillance/activations/{request_id}/approve")
def approve_surveillance_rule(request_id: int, db: Session = Depends(get_db),
                              current_user: User = Depends(get_current_compliance_user)):
    row = decide_activation(db, current_user, request_id, True)
    return {"id": row.id, "rule_id": row.rule_id, "status": row.status}


@router.post("/surveillance/activations/{request_id}/reject")
def reject_surveillance_rule(request_id: int, db: Session = Depends(get_db),
                             current_user: User = Depends(get_current_compliance_user)):
    row = decide_activation(db, current_user, request_id, False)
    return {"id": row.id, "rule_id": row.rule_id, "status": row.status}


@router.get("/surveillance/cases")
def list_surveillance_cases(db: Session = Depends(get_db)):
    return {"cases": list_cases(db)}


@router.post("/surveillance/cases/{case_id}/close")
def close_surveillance_case(case_id: int, payload: SurveillanceCaseClose, db: Session = Depends(get_db),
                            current_user: User = Depends(get_current_compliance_user)):
    row = close_case(db, current_user, case_id, payload.disposition, payload.reason)
    return {"id": row.id, "status": row.status, "disposition": row.disposition}


@router.post("/surveillance/run")
def run_surveillance(db: Session = Depends(get_db), current_user: User = Depends(get_current_compliance_user)):
    _reviewer(current_user)
    return run_live_surveillance(db)


class IncidentCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    severity: Literal["low", "moderate", "high"]
    summary: str = Field(min_length=3, max_length=255)


class SarDraftCreate(BaseModel):
    case_kind: Literal["surveillance", "aml"]
    case_id: int = Field(gt=0)


@router.get("/aml/rules")
def list_aml_rule_states(db: Session = Depends(get_db)):
    return {"rules": list_aml_rules(db)}


@router.post("/aml/rules/{rule_id}/request")
def request_aml_rule(rule_id: str, payload: SurveillanceRequestCreate, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_compliance_user)):
    row = request_aml_activation(db, current_user, rule_id, payload.reason)
    return {"id": row.id, "rule_id": row.rule_id, "version": row.version, "status": row.status}


@router.post("/aml/activations/{request_id}/approve")
def approve_aml_rule(request_id: int, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_compliance_user)):
    row = decide_aml_activation(db, current_user, request_id, True)
    return {"id": row.id, "rule_id": row.rule_id, "status": row.status}


@router.post("/aml/activations/{request_id}/reject")
def reject_aml_rule(request_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_compliance_user)):
    row = decide_aml_activation(db, current_user, request_id, False)
    return {"id": row.id, "rule_id": row.rule_id, "status": row.status}


@router.get("/aml/cases")
def get_aml_cases(db: Session = Depends(get_db)):
    return {"cases": list_aml_cases(db)}


@router.post("/aml/cases/{case_id}/close")
def close_aml(case_id: int, payload: SurveillanceCaseClose, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_compliance_user)):
    row = close_aml_case(db, current_user, case_id, payload.disposition, payload.reason)
    return {"id": row.id, "status": row.status, "disposition": row.disposition}


@router.post("/aml/run")
def run_aml(db: Session = Depends(get_db), current_user: User = Depends(get_current_compliance_user)):
    _reviewer(current_user)
    return run_live_aml(db)


@router.get("/incidents")
def get_incidents(db: Session = Depends(get_db)):
    return {"incidents": list_incidents(db)}


@router.post("/incidents")
def create_incident(payload: IncidentCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_compliance_user)):
    row = open_incident(db, current_user, payload.title, payload.severity, payload.summary)
    return {"id": row.id, "customer_notice_due_at": row.customer_notice_due_at}


@router.post("/incidents/{incident_id}/notify")
def notify_incident(incident_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_compliance_user)):
    row = record_notice(db, current_user, incident_id)
    return {"id": row.id, "customer_notified_at": row.customer_notified_at}


@router.post("/incidents/{incident_id}/close")
def finish_incident(incident_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_compliance_user)):
    row = close_incident(db, current_user, incident_id)
    return {"id": row.id, "status": row.status}


@router.get("/kris")
def get_kris(db: Session = Depends(get_db)):
    return {"kris": kri_values(db)}


@router.post("/sar-drafts")
def create_sar_draft(payload: SarDraftCreate, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_compliance_user)):
    row = create_draft(db, current_user, payload.case_kind, payload.case_id)
    return {"id": row.id, "narrative": row.narrative}


@router.get("/evidence-export")
def export_evidence(db: Session = Depends(get_db)):
    payload = build_evidence_zip(db)
    return FastAPIResponse(content=payload, media_type="application/zip",
                           headers={"Content-Disposition": "attachment; filename=evidence-bundle.zip"})


class IntentCreate(BaseModel):
    symbol: str = ""
    side: str = ""
    quantity: str = "0"
    reference_price: str = "0"
    rationale: str = ""
    confidence: str = "0"
    news: list[str] = Field(default_factory=list)


class IntentFromBars(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    closes: list[str] = Field(min_length=2)
    reference_price: str
    quantity: str = "1"
    news: list[str] = Field(default_factory=list)


@router.get("/intents")
def get_intents(db: Session = Depends(get_db)):
    return {"intents": list_intents(db)}


@router.post("/intents")
def create_intent(payload: IntentCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_compliance_user)):
    _reviewer(current_user)
    row = propose_intent(
        db, symbol=payload.symbol, side=payload.side, quantity=payload.quantity,
        reference_price=payload.reference_price, rationale=payload.rationale,
        confidence=payload.confidence, news=payload.news, proposed_by=f"user:{current_user.id}",
    )
    return {"id": row.id, "status": row.status, "rejection_reason": row.rejection_reason}


@router.post("/intents/from-bars")
def create_intent_from_bars(payload: IntentFromBars, db: Session = Depends(get_db),
                            current_user: User = Depends(get_current_compliance_user)):
    _reviewer(current_user)
    closes = [Decimal(item) for item in payload.closes]
    notional = Decimal(payload.quantity) * Decimal(payload.reference_price)
    rationale, confidence = compose_rationale(closes, settings.max_stock_position_notional, notional)
    row = propose_intent(
        db, symbol=payload.symbol, side="buy", quantity=payload.quantity,
        reference_price=payload.reference_price, rationale=rationale,
        confidence=str(confidence), news=payload.news, proposed_by="deterministic-analyst",
    )
    return {"id": row.id, "status": row.status, "rationale": row.rationale}


@router.post("/intents/{intent_id}/approve")
def approve_trade_intent(intent_id: int, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_compliance_user)):
    row = approve_intent(db, current_user, intent_id)
    return {"id": row.id, "status": row.status, "decided_by_user_id": row.decided_by_user_id}


@router.get("/findings")
def get_findings(db: Session = Depends(get_db)):
    return {"findings": list_findings(db)}


@router.get("/risk-brief")
def get_risk_brief(db: Session = Depends(get_db)):
    return {"brief": latest_brief(db)}
