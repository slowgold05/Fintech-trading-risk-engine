import math
from decimal import Decimal
from pathlib import Path

import requests
import yaml
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.aml import SanctionsScreen
from app.models.user import User


FIXTURE = Path(__file__).resolve().parents[2] / "grc" / "sanctions" / "fixture.yaml"


def normalize_name(name: str | None) -> str:
    return " ".join((name or "").casefold().split())


def fixture_names(path: Path | None = None) -> set[str]:
    loaded = yaml.safe_load((path or FIXTURE).read_text(encoding="utf-8"))
    names = loaded.get("names") if isinstance(loaded, dict) else None
    if not isinstance(names, list) or not names:
        raise ValueError("Sanctions fixture is incomplete")
    return {normalize_name(str(item)) for item in names if normalize_name(str(item))}


def screen_name(name: str | None) -> dict:
    cleaned = normalize_name(name)
    if not cleaned:
        return {"decision": "name_missing", "source": "none", "matched_name": None, "subject_name": ""}
    if settings.yente_url.strip():
        return _screen_yente(cleaned)
    matched = cleaned in fixture_names()
    return {
        "decision": "blocked" if matched else "clear",
        "source": "fixture",
        "matched_name": cleaned if matched else None,
        "subject_name": cleaned,
    }


def _provider_error(name: str) -> dict:
    return {"decision": "provider_error", "source": "yente", "matched_name": None, "subject_name": name}


def interpret_yente_payload(payload: object, name: str, threshold: Decimal | float) -> dict:
    responses = payload.get("responses") if isinstance(payload, dict) else None
    query = responses.get("q") if isinstance(responses, dict) else None
    if not isinstance(query, dict):
        return _provider_error(name)
    status = query.get("status", 200)
    results = query.get("results")
    if status not in (200, "200") or not isinstance(results, list):
        return _provider_error(name)
    limit = Decimal(str(threshold))
    for item in results:
        if not isinstance(item, dict) or "score" not in item or isinstance(item.get("score"), bool):
            return _provider_error(name)
        score = item.get("score")
        if not isinstance(score, (int, float)) or not math.isfinite(float(score)):
            return _provider_error(name)
        if Decimal(str(score)) >= limit:
            caption = str(item.get("caption") or "")[:255]
            return {"decision": "blocked", "source": "yente", "matched_name": caption or name, "subject_name": name}
    return {"decision": "clear", "source": "yente", "matched_name": None, "subject_name": name}


def _screen_yente(name: str) -> dict:
    url = settings.yente_url.rstrip("/") + "/match/default"
    body = {"queries": {"q": {"schema": "Person", "properties": {"name": [name]}}}}
    try:
        response = requests.post(url, json=body, timeout=3)
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return _provider_error(name)
    return interpret_yente_payload(payload, name, settings.yente_match_threshold)


def record_screen(db: Session, user: User, context: str, result: dict | None = None) -> SanctionsScreen:
    screened = result or screen_name(user.full_name)
    if screened["decision"] == "name_missing":
        raise ValueError("A screen requires a name")
    row = SanctionsScreen(
        user_id=user.id,
        subject_name=screened["subject_name"][:255],
        context=context,
        decision=screened["decision"],
        source=screened["source"],
        matched_name=screened["matched_name"],
    )
    db.add(row)
    db.flush()
    return row


def check_sanctions_screening(db: Session) -> dict:
    named = [user for user in db.query(User).all() if normalize_name(user.full_name)]
    from app.models.aml import CashMovement

    withdrawals = db.query(CashMovement).filter(CashMovement.kind == "withdrawal").all()
    violations = []
    for user in named:
        expected = normalize_name(user.full_name)
        screens = db.query(SanctionsScreen).filter(
            SanctionsScreen.user_id == user.id,
            SanctionsScreen.context == "onboarding",
            SanctionsScreen.decision == "clear",
        ).all()
        if not any(normalize_name(screen.subject_name) == expected for screen in screens):
            violations.append(f"user:{user.id}")
    for movement in withdrawals:
        screen = db.get(SanctionsScreen, movement.screening_id) if movement.screening_id else None
        if screen is None or screen.decision != "clear" or screen.context != "payout" or screen.user_id != movement.user_id:
            violations.append(f"movement:{movement.id}")
    return {"checked": len(named) + len(withdrawals), "violation_count": len(violations), "violations": violations[:20]}
