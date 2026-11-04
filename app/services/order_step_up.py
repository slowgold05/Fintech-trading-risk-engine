from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_quote_cache import MarketQuoteCache
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.mfa import confirmed_factor, consume_totp
from app.services.trade_execution import notional_amount


def order_notional(db: Session, payload: OrderCreate) -> Decimal:
    if payload.order_type == "limit" and payload.limit_price is not None:
        return notional_amount(payload.quantity, payload.limit_price)
    quote = db.get(MarketQuoteCache, payload.symbol)
    price = quote.price if quote is not None else Decimal("0")
    return notional_amount(payload.quantity, price * Decimal("1.20"))


def require_notional_step_up(db: Session, user: User, notional: Decimal, code: str | None) -> None:
    if notional < settings.large_order_step_up_notional:
        return
    factor = confirmed_factor(db, user.id)
    if factor is None:
        if settings.mfa_required:
            raise HTTPException(status_code=403, detail="A large order requires a confirmed authenticator")
        return
    if consume_totp(db, user.id, code) is None:
        raise HTTPException(status_code=403, detail="A large order requires a current authenticator code")
