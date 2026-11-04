import hashlib
import ipaddress
import json
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.mfa import LoginEvent
from app.models.user import User


STEP_UP_SCORE = 40
NEW_DEVICE_SCORE = 40
IMPOSSIBLE_TRAVEL_SCORE = 50
STUFFING_SCORE = 50
STUFFING_FAILURES = 5
STUFFING_ACCOUNTS = 3
STUFFING_MINUTES = 10


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def request_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def user_agent_hash(request: Request) -> str:
    return hashlib.sha256((request.headers.get("user-agent") or "").encode()).hexdigest()


def _regions() -> list[tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, str]]:
    found = []
    for part in settings.login_geo_prefixes.split(","):
        cidr, _, name = part.partition("=")
        cidr, name = cidr.strip(), name.strip()
        if not cidr or not name:
            continue
        try:
            found.append((ipaddress.ip_network(cidr, strict=False), name))
        except ValueError:
            continue
    return found


def region_for(ip: str | None) -> str | None:
    if not ip:
        return None
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return None
    for network, name in _regions():
        if address in network:
            return name
    return None


def assess_login(db: Session, user: User, request: Request) -> dict:
    ip = request_ip(request)
    agent = user_agent_hash(request)
    now = _now()
    reasons = []
    score = 0
    prior = db.execute(select(LoginEvent).where(
        LoginEvent.user_id == user.id, LoginEvent.outcome == "success")).scalars().all()
    if prior and agent not in {row.user_agent_hash for row in prior}:
        score += NEW_DEVICE_SCORE
        reasons.append("new_device")
    last = max(prior, key=lambda row: (row.created_at, row.id)) if prior else None
    current_region = region_for(ip)
    previous_region = region_for(last.ip) if last is not None else None
    if (last is not None and current_region and previous_region and current_region != previous_region
            and now - last.created_at <= timedelta(minutes=settings.impossible_travel_minutes)):
        score += IMPOSSIBLE_TRAVEL_SCORE
        reasons.append("impossible_travel")
    window_start = now - timedelta(minutes=STUFFING_MINUTES)
    failures = db.execute(select(LoginEvent).where(
        LoginEvent.ip == ip, LoginEvent.outcome == "failure", LoginEvent.created_at >= window_start)).scalars().all()
    if len(failures) >= STUFFING_FAILURES and len({row.email for row in failures}) >= STUFFING_ACCOUNTS:
        score += STUFFING_SCORE
        reasons.append("credential_stuffing")
    return {"score": score, "reasons": reasons, "step_up": score >= STEP_UP_SCORE,
            "ip": ip, "user_agent_hash": agent}


def record_login_event(db: Session, email: str, request: Request, outcome: str, score: int,
                       reasons: list[str], user_id: int | None = None, step_up_satisfied: bool = False,
                       ip: str | None = None, agent: str | None = None) -> None:
    db.add(LoginEvent(
        user_id=user_id,
        email=email[:255],
        ip=ip if ip is not None else request_ip(request),
        user_agent_hash=agent or user_agent_hash(request),
        outcome=outcome,
        risk_score=score,
        step_up_satisfied=step_up_satisfied,
        reasons=json.dumps(reasons),
        created_at=_now(),
    ))


def check_high_risk_logins(db: Session) -> dict:
    rows = db.execute(select(LoginEvent)).scalars().all()
    violations = [row.id for row in rows
                  if row.outcome == "success" and row.risk_score >= STEP_UP_SCORE and not row.step_up_satisfied]
    return {"checked": len(rows), "violation_count": len(violations), "violation_ids": violations[:20]}
