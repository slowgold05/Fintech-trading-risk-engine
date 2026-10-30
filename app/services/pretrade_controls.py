from fastapi import HTTPException
from decimal import Decimal
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_quote_cache import MarketQuoteCache
from app.models.asset import Asset
from app.models.order import Order
from app.models.holding import Holding
from app.models.user import User
from app.services.market_cache_service import _freshness


def require_trading_open() -> None:
    # shortcut: process config requires an API restart; add an audited operator switch for real-time halts.
    if settings.trading_halted:
        raise HTTPException(status_code=503, detail="Trading is halted (SM-PT-01)")


def _price_band_problem(quote: MarketQuoteCache | None, price: Decimal | None) -> str | None:
    if (quote is None or quote.price <= 0 or quote.quote_at is None
            or quote.quote_at > datetime.now(timezone.utc).replace(tzinfo=None)
            or _freshness(quote, "hot")[0] == "stale"):
        return "Usable reference quote unavailable (SM-PT-02)"
    if price is not None and (price < quote.price * Decimal("0.80") or price > quote.price * Decimal("1.20")):
        return "Order price outside the 20% reference band (SM-PT-02)"
    return None


def require_price_in_band(db: Session, symbol: str, price: Decimal | None) -> None:
    problem = _price_band_problem(db.get(MarketQuoteCache, symbol), price)
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


def require_stock_concentration(db: Session, user: User, asset: Asset, buy_qty: Decimal,
                                reference_price: Decimal, order_price: Decimal) -> None:
    equity = user.cash_balance
    held_qty = Decimal(0)
    for holding, held_asset in db.execute(
        select(Holding, Asset).join(Asset, Holding.asset_id == Asset.id).where(Holding.user_id == user.id)
    ):
        if held_asset.id == asset.id:
            held_qty = holding.quantity
        quote = db.get(MarketQuoteCache, held_asset.symbol) if held_asset.asset_type == "stock" else None
        # shortcut: use book cost when another holding lacks a usable quote; require full marks for a stricter risk limit.
        mark = quote.price if quote is not None and _price_band_problem(quote, None) is None else holding.avg_cost
        equity += holding.quantity * mark

    pending_exposure = sum((row.remaining_quantity * max(row.limit_price or reference_price * Decimal("1.20"), reference_price) for row in db.execute(
        select(Order).where(Order.user_id == user.id, Order.asset_id == asset.id,
                            Order.side == "buy", Order.status == "open")
    ).scalars()), Decimal(0))
    exposure = held_qty * reference_price + pending_exposure + buy_qty * max(order_price, reference_price)
    if equity <= 0 or exposure * 100 > equity * settings.max_stock_concentration_pct:
        raise HTTPException(status_code=400, detail="Stock concentration limit exceeded (SM-PT-03)")
