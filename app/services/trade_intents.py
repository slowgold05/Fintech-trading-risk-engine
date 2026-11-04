"""Propose-only trade intents.

An intent is a record. Approving it does not create an order. Deterministic
notes describe bars. They are not a language-model call.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.expansion import TradeIntent
from app.models.user import User
from app.services.signals import scan_untrusted


REVIEW_ROLES = {"admin", "compliance_officer"}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def technical_note(closes: list[Decimal]) -> str:
    if len(closes) < 2:
        return "Not enough bars for a technical note."
    direction = "up" if closes[-1] > closes[0] else "down" if closes[-1] < closes[0] else "flat"
    return f"Close moved {direction} across {len(closes)} bars."


def risk_note(hard_limit: Decimal, notional: Decimal) -> str:
    relation = "inside" if notional <= hard_limit else "outside"
    return f"Notional is {relation} the hard position limit."


def debate_note(closes: list[Decimal], hard_limit: Decimal, notional: Decimal) -> str:
    technical = technical_note(closes)
    risk = risk_note(hard_limit, notional)
    if "up" in technical:
        bull = "Bull case: the close is higher than the first bar."
    elif "down" in technical:
        bull = "Bull case: no higher close is present."
    else:
        bull = "Bull case: the close is unchanged."
    if "outside" in risk:
        bear = "Bear case: notional is outside the hard limit."
    elif "down" in technical:
        bear = "Bear case: the close is lower than the first bar."
    else:
        bear = "Bear case: the hard limit still applies."
    return f"{bull} {bear}"


def compose_rationale(closes: list[Decimal], hard_limit: Decimal, notional: Decimal) -> tuple[str, Decimal]:
    technical = technical_note(closes)
    risk = risk_note(hard_limit, notional)
    disagree = ("up" in technical and "outside" in risk) or ("down" in technical and "outside" in risk)
    confidence = Decimal("0.40") if disagree else Decimal("0.50")
    return f"{technical} {risk} {debate_note(closes, hard_limit, notional)}", confidence


def propose_intent(db: Session, *, symbol: str, side: str, quantity: str, reference_price: str,
                   rationale: str, confidence: str, news: list[str], proposed_by: str) -> TradeIntent:
    reasons = []
    cleaned_symbol = symbol.strip().upper()
    if not cleaned_symbol or len(cleaned_symbol) > 20 or side not in {"buy", "sell"}:
        reasons.append("malformed")
    qty = None
    price = None
    try:
        qty = Decimal(str(quantity))
        price = Decimal(str(reference_price))
        score = Decimal(str(confidence))
    except (InvalidOperation, ValueError):
        qty = price = None
        score = Decimal(0)
        reasons.append("malformed")
    if qty is None or price is None or qty <= 0 or price <= 0 or score < 0 or score > 1:
        if "malformed" not in reasons:
            reasons.append("malformed")
    texts = [rationale, *news]
    if any(scan_untrusted(text) for text in texts):
        reasons.append("injection")
    if qty is not None and price is not None and qty > 0 and price > 0 and qty * price > settings.max_stock_position_notional:
        reasons.append("oversized")
    status = "rejected" if reasons else "proposed"
    row = TradeIntent(
        symbol=cleaned_symbol or "INVALID",
        side=side if side in {"buy", "sell"} else "buy",
        quantity=qty if qty is not None and qty > 0 else Decimal("0.000001"),
        reference_price=price if price is not None and price > 0 else Decimal("0.000001"),
        rationale=rationale[:2000],
        confidence=score if 0 <= score <= 1 else Decimal(0),
        data_used=json.dumps({"news_count": len(news), "reasons": reasons}),
        status=status,
        rejection_reason=", ".join(reasons) or None,
        proposed_by=proposed_by[:64] or "analyst",
        created_at=_now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def approve_intent(db: Session, user: User, intent_id: int) -> TradeIntent:
    if user.role not in REVIEW_ROLES:
        raise HTTPException(status_code=403, detail="A reviewer role is required")
    row = db.get(TradeIntent, intent_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Intent not found")
    if row.status != "proposed":
        raise HTTPException(status_code=409, detail="Only a proposed intent can be approved")
    row.status = "approved"
    row.decided_by_user_id = user.id
    row.decided_at = _now()
    db.commit()
    db.refresh(row)
    return row


def list_intents(db: Session) -> list[dict]:
    rows = db.execute(select(TradeIntent).order_by(TradeIntent.id.desc())).scalars().all()
    return [{
        "id": row.id, "symbol": row.symbol, "side": row.side, "status": row.status,
        "rejection_reason": row.rejection_reason, "proposed_by": row.proposed_by,
        "decided_by_user_id": row.decided_by_user_id, "decided_at": row.decided_at,
    } for row in rows]


def check_intent_approvals(db: Session) -> dict:
    rows = db.execute(select(TradeIntent)).scalars().all()
    violations = [row.id for row in rows if row.status == "approved" and row.decided_by_user_id is None]
    return {"checked": len(rows), "violation_count": len(violations), "violation_ids": violations[:20]}


def check_signal_gate(db: Session) -> dict:
    rows = db.execute(select(TradeIntent)).scalars().all()
    violations = []
    for row in rows:
        reasons = json.loads(row.data_used).get("reasons") or []
        if "injection" in reasons and row.status != "rejected":
            violations.append(row.id)
        elif scan_untrusted(row.rationale) and row.status == "proposed":
            violations.append(row.id)
    return {"checked": len(rows), "violation_count": len(violations), "violation_ids": violations[:20]}
