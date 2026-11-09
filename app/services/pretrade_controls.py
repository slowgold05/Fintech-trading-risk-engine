from fastapi import HTTPException
from decimal import Decimal
from datetime import datetime, timezone
import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_quote_cache import MarketQuoteCache
from app.models.asset import Asset
from app.models.order import Order
from app.models.holding import Holding
from app.models.user import User
from app.models.trading_halt import TradingHaltState, TradingHaltEvent
from app.services.market_cache_service import _as_naive_utc, _freshness


def trading_halt_reason(state: TradingHaltState | None) -> str | None:
    if settings.trading_halted or state is None or state.halted:
        return "Trading is halted (SM-PT-01)"
    return None


def require_trading_open(db: Session) -> None:
    state = db.execute(select(TradingHaltState).where(TradingHaltState.id == 1)
                       .with_for_update().execution_options(populate_existing=True)).scalar_one_or_none()
    reason = trading_halt_reason(state)
    if reason is not None:
        raise HTTPException(status_code=503, detail=reason)


def check_trading_halt_audit(db: Session) -> dict:
    state = db.get(TradingHaltState, 1)
    events = db.execute(select(TradingHaltEvent).order_by(TradingHaltEvent.id)).scalars().all()
    prior = False
    violations = []
    for event in events:
        if event.previous_halted != prior or event.halted == prior or event.actor_user_id is None or not event.reason.strip():
            violations.append(event.id)
        prior = event.halted
    if state is None or state.halted != prior:
        violations.append("state")
    return {"checked": len(events), "violation_count": len(violations), "violations": violations[:20]}


def _non_finite_reference(price: object) -> bool:
    # Numeric NaN/Infinity compare as unordered. Reject them before <= or the band, and do not invent a price.
    if isinstance(price, Decimal):
        return not price.is_finite()
    if isinstance(price, float):
        return not math.isfinite(price)
    return False


def _price_band_problem(
    quote: MarketQuoteCache | None,
    price: Decimal | None,
    *,
    now: datetime | None = None,
) -> str | None:
    # None keeps today's two wall-clock reads. A passed clock is one instant for the future test and freshness.
    clock = datetime.now(timezone.utc).replace(tzinfo=None) if now is None else _as_naive_utc(now)
    if (quote is None or _non_finite_reference(quote.price) or quote.price <= 0 or quote.quote_at is None
            or quote.quote_at > clock
            or _freshness(quote, "hot", now=now)[0] == "stale"):
        return "Usable reference quote unavailable (SM-PT-02)"
    if price is not None and (price < quote.price * Decimal("0.80") or price > quote.price * Decimal("1.20")):
        return "Order price outside the 20% reference band (SM-PT-02)"
    return None


def require_price_in_band(db: Session, symbol: str, price: Decimal | None, *, now: datetime | None = None) -> None:
    problem = _price_band_problem(db.get(MarketQuoteCache, symbol), price, now=now)
    if problem:
        raise HTTPException(status_code=503 if problem.startswith("Usable") else 400, detail=problem)


def check_open_order_price_bands(db: Session) -> dict:
    rows = db.execute(
        select(Order, Asset.symbol, MarketQuoteCache)
        .join(Asset, Order.asset_id == Asset.id)
        .outerjoin(MarketQuoteCache, MarketQuoteCache.symbol == Asset.symbol)
        .where(Order.status == "open")
    ).all()
    violations = [
        {"order_id": order.id, "symbol": symbol, "reason": problem}
        for order, symbol, quote in rows
        if (problem := _price_band_problem(quote, order.limit_price))
    ]
    return {"checked": len(rows), "violation_count": len(violations), "examples": violations[:20]}


def require_stock_concentration(
    db: Session,
    user: User,
    asset: Asset | None,
    buy_qty: Decimal,
    reference_price: Decimal,
    order_price: Decimal,
    *,
    now: datetime | None = None,
) -> None:
    equity = user.cash_balance
    held_qty = Decimal(0)
    for holding, held_asset in db.execute(
        select(Holding, Asset).join(Asset, Holding.asset_id == Asset.id).where(Holding.user_id == user.id)
    ):
        if asset is not None and held_asset.id == asset.id:
            held_qty = holding.quantity
        quote = db.get(MarketQuoteCache, held_asset.symbol) if held_asset.asset_type == "stock" else None
        # shortcut: use book cost when another holding lacks a usable quote; require full marks for a stricter risk limit.
        mark = quote.price if quote is not None and _price_band_problem(quote, None, now=now) is None else holding.avg_cost
        equity += holding.quantity * mark

    if asset is None:
        pending_exposure = Decimal(0)
    else:
        pending_exposure = sum((row.remaining_quantity * max(row.limit_price or reference_price * Decimal("1.20"), reference_price) for row in db.execute(
            select(Order).where(Order.user_id == user.id, Order.asset_id == asset.id,
                                Order.side == "buy", Order.status == "open")
        ).scalars()), Decimal(0))
    exposure = held_qty * reference_price + pending_exposure + buy_qty * max(order_price, reference_price)
    if equity <= 0 or exposure * 100 > equity * settings.max_stock_concentration_pct:
        raise HTTPException(status_code=400, detail="Stock concentration limit exceeded (SM-PT-03)")
    if exposure > settings.max_stock_position_notional:
        raise HTTPException(status_code=400, detail="Stock position-size limit exceeded (SM-PT-05)")
