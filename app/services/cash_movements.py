from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.aml import CashMovement
from app.models.user import User
from app.services.ledger_service import append_event
from app.services.sanctions import normalize_name, record_screen, screen_name
from app.services.trade_execution import notional_amount, reserved_cash


def post_movement(db: Session, user: User, kind: str, amount: Decimal, screening_id: int | None) -> CashMovement:
    locked = db.execute(
        select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()
    posted = notional_amount(Decimal(1), amount)
    if posted <= 0:
        raise HTTPException(status_code=422, detail="Amount must be positive")
    if kind == "withdrawal":
        available = locked.cash_balance - reserved_cash(db, locked.id)
        if posted > available:
            raise HTTPException(status_code=400, detail="Insufficient cash for this withdrawal")
        signed = -posted
        event_kind = "cash_withdrawal"
    elif kind == "deposit":
        signed = posted
        event_kind = "cash_deposit"
    else:
        raise HTTPException(status_code=422, detail="Movement kind is invalid")
    append_event(db, locked.id, event_kind, [
        ("cash", None, "USD", signed),
        ("offset", None, "USD", -signed),
    ])
    locked.cash_balance = locked.cash_balance + signed
    movement = CashMovement(user_id=locked.id, kind=kind, amount=posted, screening_id=screening_id)
    db.add(movement)
    db.flush()
    return movement


def authorize_withdrawal(db: Session, user: User) -> dict:
    if not normalize_name(user.full_name):
        raise HTTPException(status_code=403, detail="A legal name is required before a withdrawal")
    result = screen_name(user.full_name)
    if result["decision"] != "clear":
        record_screen(db, user, "payout", result)
        db.commit()
        detail = "Sanctions screening is unavailable" if result["decision"] == "provider_error" else "This withdrawal is blocked by sanctions screening"
        raise HTTPException(status_code=403, detail=detail)
    return result
