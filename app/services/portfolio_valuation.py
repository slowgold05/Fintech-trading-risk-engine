"""Cached portfolio valuation from one consistent database read.

JSON numbers are IEEE floats. Money is quantized to cents before that boundary.
Quantity and unit prices are quantized to the stored scale, then converted with float.
Null valuation fields stay null. They are not zero and they are not omitted.
"""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.read_snapshot import SnapshotClockError, consistent_read, snapshot_clock
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import User
from app.services.market_cache_service import _freshness
from app.services.trade_execution import notional_amount

CENT = Decimal("0.01")
UNIT = Decimal("0.0001")
QUANTITY_UNIT = Decimal("0.000001")
SUPPORTED_ASSET_TYPES = {"stock"}
ELIGIBLE_QUOTE_STATUSES = {"live-ish", "delayed", "cached"}


def _money(value: Decimal) -> float:
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


def _unit(value: Decimal) -> float:
    return float(value.quantize(UNIT, rounding=ROUND_HALF_UP))


def _quantity(value: Decimal) -> float:
    return float(value.quantize(QUANTITY_UNIT, rounding=ROUND_HALF_UP))


def _decimal(value: object) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=500, detail="Portfolio value is not a decimal.") from exc
    return number


def _naive_utc(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        parsed = value.strip().replace("Z", "+00:00")
        if " " in parsed and "T" not in parsed:
            parsed = parsed.replace(" ", "T", 1)
        try:
            value = datetime.fromisoformat(parsed)
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _iso_z(value: object) -> str | None:
    naive = _naive_utc(value)
    if naive is None:
        return None
    return naive.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _realized_subquery(user_id: int):
    latest_reset_id = (
        select(func.max(LedgerEntry.id))
        .where(LedgerEntry.user_id == user_id, LedgerEntry.event_kind == "reset")
        .scalar_subquery()
    )
    trades_after_reset = select(LedgerEntry.trade_id).where(
        LedgerEntry.user_id == user_id,
        LedgerEntry.event_kind == "trade",
        LedgerEntry.id > latest_reset_id,
    )
    return (
        select(func.coalesce(func.sum(Trade.realized_pnl), 0))
        .where(
            Trade.user_id == user_id,
            Trade.side == "sell",
            or_(latest_reset_id.is_(None), Trade.id.in_(trades_after_reset)),
        )
        .scalar_subquery()
    )


def _reserved_cash(db: Session, user_id: int) -> Decimal:
    rows = db.execute(
        select(Order.remaining_quantity, Order.limit_price).where(
            Order.user_id == user_id,
            Order.side == "buy",
            Order.status == "open",
            Order.limit_price.is_not(None),
        )
    ).all()
    reserved = Decimal(0)
    for quantity, limit_price in rows:
        reserved += notional_amount(_decimal(quantity), _decimal(limit_price))
    return reserved


def _quote_state(row, snapshot: datetime) -> dict:
    source = row.quote_source
    quote_at = row.quote_at
    fetched_at = row.fetched_at
    known_times = {
        "source": source,
        "quote_at": _iso_z(quote_at),
        "fetched_at": _iso_z(fetched_at),
    }
    has_quote = any(value is not None for value in (row.quote_price, source, quote_at, fetched_at))

    if row.asset_type not in SUPPORTED_ASSET_TYPES:
        return {
            "price_status": "unavailable",
            "unavailable_reason": "unsupported_asset",
            "price": None,
            **known_times,
        }
    if not has_quote:
        return {
            "price_status": "unavailable",
            "unavailable_reason": "missing",
            "price": None,
            "source": None,
            "quote_at": None,
            "fetched_at": None,
        }

    try:
        price = Decimal(str(row.quote_price))
    except (InvalidOperation, ValueError):
        price = Decimal("NaN")
    if not price.is_finite() or price <= 0:
        return {
            "price_status": "unavailable",
            "unavailable_reason": "invalid",
            "price": None,
            **known_times,
        }

    observed = _naive_utc(quote_at)
    if observed is not None and observed > snapshot:
        return {
            "price_status": "unavailable",
            "unavailable_reason": "invalid",
            "price": None,
            **known_times,
        }

    status, _age = _freshness(
        SimpleNamespace(source=source, quote_at=observed),
        row.refresh_tier or "daily",
        now=snapshot,
    )
    if status not in ELIGIBLE_QUOTE_STATUSES:
        return {
            "price_status": "unavailable",
            "unavailable_reason": "stale",
            "price": None,
            **known_times,
        }
    return {
        "price_status": "available",
        "unavailable_reason": None,
        "price": price,
        **known_times,
    }


def _value_portfolio(db: Session, user_id: int, email: str) -> dict:
    try:
        snapshot = snapshot_clock(db)
    except SnapshotClockError as exc:
        raise HTTPException(status_code=500, detail="Portfolio snapshot time is missing.") from exc
    snapshot_stmt = (
        select(
            User.cash_balance,
            Holding.quantity,
            Holding.avg_cost,
            Asset.symbol,
            Asset.asset_type,
            MarketQuoteCache.price.label("quote_price"),
            MarketQuoteCache.source.label("quote_source"),
            MarketQuoteCache.quote_at,
            MarketQuoteCache.fetched_at,
            MarketSymbol.refresh_tier,
            _realized_subquery(user_id).label("realized_pnl"),
        )
        .select_from(User)
        .outerjoin(Holding, (Holding.user_id == User.id) & (Holding.quantity != 0))
        .outerjoin(Asset, Asset.id == Holding.asset_id)
        .outerjoin(MarketQuoteCache, MarketQuoteCache.symbol == Asset.symbol)
        .outerjoin(MarketSymbol, MarketSymbol.symbol == Asset.symbol)
        .where(User.id == user_id)
        .order_by(Asset.symbol.asc())
    )
    rows = list(db.execute(snapshot_stmt).all())
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")

    cash_balance = _decimal(rows[0].cash_balance)
    realized = _decimal(rows[0].realized_pnl)
    # Reservations use the same snapshot transaction as the position read.
    reserved = _reserved_cash(db, user_id)

    position_rows = [row for row in rows if row.symbol is not None]
    position_rows.sort(key=lambda row: row.symbol)

    positions = []
    securities_value = Decimal(0)
    cost_total = Decimal(0)
    complete = True

    for row in position_rows:
        quantity = _decimal(row.quantity)
        avg_cost = _decimal(row.avg_cost)
        cost_basis = quantity * avg_cost
        cost_total += cost_basis
        quote = _quote_state(row, snapshot)
        if quote["price_status"] != "available":
            complete = False
            current_price = None
            position_value = None
            unrealized = None
            unrealized_pct = None
        else:
            price = quote["price"]
            raw_value = quantity * price
            raw_unrealized = raw_value - cost_basis
            securities_value += raw_value
            current_price = _unit(price)
            position_value = _money(raw_value)
            unrealized = _money(raw_unrealized)
            unrealized_pct = _money((raw_unrealized / cost_basis * 100) if cost_basis > 0 else Decimal(0))
        positions.append({
            "symbol": row.symbol,
            "asset_type": row.asset_type,
            "quantity": _quantity(quantity),
            "avg_cost": _unit(avg_cost),
            "current_price": current_price,
            "position_value": position_value,
            "cost_basis": _money(cost_basis),
            "unrealized_pnl": unrealized,
            "unrealized_pnl_pct": unrealized_pct,
            "price_status": quote["price_status"],
            "unavailable_reason": quote["unavailable_reason"],
            "source": quote["source"],
            "quote_at": quote["quote_at"],
            "fetched_at": quote["fetched_at"],
        })

    unavailable_symbols = sorted(
        position["symbol"] for position in positions if position["price_status"] != "available"
    )
    summary = {
        "cash_balance": _money(cash_balance),
        "buying_power": _money(cash_balance - reserved),
        "total_cost_basis": _money(cost_total),
        "total_realized_pnl": _money(realized),
    }
    if complete:
        unrealized_total = securities_value - cost_total
        unrealized_pct = (unrealized_total / cost_total * 100) if cost_total > 0 else Decimal(0)
        summary.update({
            "total_account_value": _money(cash_balance + securities_value),
            "total_portfolio_value": _money(securities_value),
            "total_unrealized_pnl": _money(unrealized_total),
            "total_unrealized_pnl_pct": _money(unrealized_pct),
            "total_pnl": _money(realized + unrealized_total),
        })
    else:
        summary.update({
            "total_account_value": None,
            "total_portfolio_value": None,
            "total_unrealized_pnl": None,
            "total_unrealized_pnl_pct": None,
            "total_pnl": None,
        })

    return {
        "user": {"id": user_id, "email": email},
        "valuation_status": "complete" if complete else "incomplete",
        "snapshot_read_at": _iso_z(snapshot),
        "unavailable_symbols": unavailable_symbols,
        "positions": positions,
        "summary": summary,
    }


def build_portfolio_response(db: Session, user_id: int, email: str) -> dict:
    with consistent_read(db):
        return _value_portfolio(db, user_id, email)
