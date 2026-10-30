from hashlib import sha256
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
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
from app.services.control_evidence import EVIDENCE_DIR, control_status


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


def current_review_period() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year}-Q{(now.month - 1) // 3 + 1}"


def latest_role_change_id(db: Session, user_id: int) -> int | None:
    return db.execute(select(func.max(RoleChange.id)).where(RoleChange.user_id == user_id)).scalar_one()


@router.get("/controls")
def list_controls():
    controls = []
    for definition in sorted(CONTROL_DIR.glob("*.yaml")):
        control = yaml.safe_load(definition.read_text(encoding="utf-8"))
        control_id = control["id"]
        item = {"id": control_id, "title": control["title"], "owner": control["owner"],
                "frequency": control["frequency"], "status": "not_run", "run_at": None,
                "checked": None, "sha256": None}
        files = (EVIDENCE_DIR / control_id).glob("*.json")
        latest = max(files, key=lambda path: path.stat().st_mtime, default=None)
        if latest is not None:
            try:
                payload = latest.read_bytes()
                evidence = json.loads(payload)
                if evidence["control_id"] != control_id:
                    raise ValueError("Control ID mismatch")
                item.update(status=control_status(control_id, evidence["result"]),
                            run_at=evidence["run_at"], checked=evidence["result"].get("checked"),
                            sha256=sha256(payload).hexdigest())
            except (OSError, ValueError, KeyError, TypeError):
                item["status"] = "evidence_error"
        controls.append(item)
    return {"controls": controls}


@router.get("/risks")
def list_risks():
    register = yaml.safe_load(RISK_REGISTER.read_text(encoding="utf-8"))
    controls = {item["id"]: item for item in list_controls()["controls"]}
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
