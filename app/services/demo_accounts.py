"""Create and replay a bounded demo portfolio in an account transaction."""

from bisect import bisect_right
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
from secrets import token_urlsafe
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.lot import Lot
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.price_history_daily import PriceHistoryDaily
from app.models.user import User
from app.services.demo_market_history import demo_daily_closes
from app.services.ledger_service import append_reset, ensure_opening
from app.services.trade_execution import execute_fill


STARTING_CASH = Decimal("100000.00")
PLANS = json.loads(Path(__file__).with_name("demo_plans.json").read_text())
ADMISSION_LOCK = 0x534D44454D4F
MEMBERSHIP = (
    MarketSymbol.is_active.is_(True),
    MarketSymbol.is_test.is_(False),
    or_(Asset.id.is_(None), (Asset.asset_type == "stock") & Asset.is_active.is_(True)),
)
SEED_MESSAGES = {
    "historical": "Paper trades seeded from stored daily closes.",
    "cached_quotes": "No daily history was available. Paper trades were dated today using the latest cached quotes.",
    "cash_only": "No usable market prices were available for this demo plan. The account starts with paper cash.",
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _daily_admission(db: Session, today: date) -> int:
    if settings.demo_daily_limit == 0:
        raise HTTPException(status_code=503, detail="Demo signup is disabled")
    if db.get_bind().dialect.name == "postgresql":
        if not db.scalar(select(func.pg_try_advisory_xact_lock(ADMISSION_LOCK))):
            raise HTTPException(status_code=429, detail="Demo signup is busy. Try again shortly.", headers={"Retry-After": "1"})
    count = db.scalar(select(func.count()).select_from(User).where(
        User.demo_seed.is_not(None), User.created_at >= datetime.combine(today, time.min),
    ))
    if count >= settings.demo_daily_limit:
        raise HTTPException(status_code=429, detail="Today's demo signup limit has been reached")
    return count


def _fill(symbol: str, day: date, side: str, quantity: int, price: Decimal, provider: str, adjustment: str) -> dict:
    return {
        "symbol": symbol, "date": day.isoformat(), "side": side, "quantity": quantity,
        "price": str(price), "provider": provider, "adjustment": adjustment,
    }


def _historical_fills(db: Session, plan: dict, today: date) -> list[dict]:
    symbols = set(db.scalars(select(MarketSymbol.symbol).outerjoin(Asset, Asset.symbol == MarketSymbol.symbol)
                            .where(MarketSymbol.symbol.in_([item["symbol"] for item in plan["buys"]]), *MEMBERSHIP)))
    histories = demo_daily_closes(db, symbols, today - timedelta(days=225), today - timedelta(days=1))
    days_by_symbol = {symbol: sorted(closes) for symbol, (_, closes) in histories.items()}
    fills = []
    buys = {}
    for side, instructions in (("buy", plan["buys"]), ("sell", plan["sells"])):
        for item in instructions:
            symbol = item["symbol"]
            if symbol not in histories:
                continue
            source, closes = histories[symbol]
            days = days_by_symbol[symbol]
            target = today - timedelta(days=item["days_ago"])
            day = days[max(bisect_right(days, target) - 1, 0)]
            price = closes[day]
            if side == "buy":
                quantity = int(STARTING_CASH * item["weight_pct"] / 100 / price)
                buys[symbol] = (day, quantity)
            else:
                buy = buys.get(symbol)
                if buy is None or day <= buy[0]:
                    continue
                quantity = buy[1] * item["fraction_pct"] // 100
            if quantity:
                fills.append(_fill(symbol, day, side, quantity, price, source.provider, source.adjustment))
    return sorted(fills, key=lambda fill: (fill["date"], fill["side"], fill["symbol"]))


def _has_stored_history(db: Session) -> bool:
    return db.scalar(select(or_(
        select(MarketBarDaily.symbol).where(MarketBarDaily.quality_status == "valid").exists(),
        select(PriceHistoryDaily.symbol).exists(),
    )))


def _quote_fills(db: Session, plan: dict, now: datetime) -> list[dict]:
    preferred = [item["symbol"] for item in plan["buys"]]
    budget = STARTING_CASH * Decimal("0.08")
    quotes = db.scalars(select(MarketQuoteCache).join(MarketSymbol).outerjoin(
        Asset, Asset.symbol == MarketSymbol.symbol,
    ).where(
        *MEMBERSHIP, MarketQuoteCache.price > 0, MarketQuoteCache.price <= budget,
        MarketQuoteCache.fetched_at <= now,
        or_(MarketQuoteCache.quote_at.is_(None), MarketQuoteCache.quote_at <= now),
    ).order_by(
        MarketQuoteCache.symbol.in_(preferred).desc(),
        MarketQuoteCache.quote_at.desc().nulls_last(), MarketQuoteCache.fetched_at.desc(), MarketQuoteCache.symbol,
    ).limit(3))
    fills = []
    for quote in quotes:
        fill = _fill(quote.symbol, now.date(), "buy", int(budget / quote.price), quote.price, quote.source, "cached_quote")
        fill["quote_at"] = quote.quote_at.isoformat() + "Z" if quote.quote_at else None
        fills.append(fill)
    return fills


def _build_seed(db: Session, now: datetime, plan_index: int) -> dict:
    today = now.date()
    plan = PLANS[plan_index]
    fills = _historical_fills(db, plan, today)
    if not fills:
        for alternate in PLANS:
            if alternate is plan:
                continue
            fills = _historical_fills(db, alternate, today)
            if fills:
                plan = alternate
                break
    if fills:
        mode = "historical"
        opening = date.fromisoformat(fills[0]["date"]) - timedelta(days=7)
    else:
        if not _has_stored_history(db):
            fills = _quote_fills(db, plan, now)
        mode = "cached_quotes" if fills else "cash_only"
        opening = today
    return {
        "plan": plan["name"], "display_name": plan["display_name"], "mode": mode,
        "opening_date": opening.isoformat(), "fills": fills,
    }


def _replay(db: Session, user: User) -> None:
    fills = user.demo_seed["fills"]
    symbols = {fill["symbol"] for fill in fills}
    if not symbols:
        return
    assets = {asset.symbol: asset for asset in db.scalars(select(Asset).where(Asset.symbol.in_(symbols)))}
    missing = symbols - assets.keys()
    if missing:
        insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
        rows = [
            {"symbol": symbol, "asset_type": "stock", "name": name, "is_active": True}
            for symbol, name in db.execute(select(MarketSymbol.symbol, MarketSymbol.company_name)
                                           .where(MarketSymbol.symbol.in_(missing)).order_by(MarketSymbol.symbol))
        ]
        db.execute(insert(Asset).values(rows).on_conflict_do_nothing(index_elements=[Asset.symbol]))
        assets.update({asset.symbol: asset for asset in db.scalars(select(Asset).where(Asset.symbol.in_(missing)))})
    for fill in fills:
        asset = assets[fill["symbol"]]
        if asset.asset_type != "stock":
            raise HTTPException(status_code=409, detail="Demo symbol is registered as another asset type")
        execute_fill(
            db, user, asset, fill["side"], Decimal(fill["quantity"]), Decimal(fill["price"]),
            executed_at=datetime.fromisoformat(fill["date"]), demo_seed=True,
        )


def create_demo_account(db: Session) -> User:
    now = _utc_now()
    count = _daily_admission(db, now.date())
    plan_index = (now.date().toordinal() + count) % len(PLANS)
    seed = _build_seed(db, now, plan_index)
    user = User(
        email=f"demo-{uuid4().hex}@example.com", password_hash=hash_password(token_urlsafe(32)),
        cash_balance=STARTING_CASH, demo_seed=seed,
    )
    db.add(user)
    db.flush()
    ensure_opening(db, user, effective_on=date.fromisoformat(seed["opening_date"]))
    _replay(db, user)
    return user


def restore_demo_portfolio(db: Session, user: User) -> None:
    latest = db.scalars(select(LedgerEntry).where(LedgerEntry.user_id == user.id)
                        .order_by(LedgerEntry.id.desc()).limit(1)).one()
    if latest.effective_on is not None:
        return  # The last posting belongs to the original or restored seed.
    append_reset(db, user, STARTING_CASH, effective_on=date.fromisoformat(user.demo_seed["opening_date"]))
    db.query(Lot).filter(Lot.user_id == user.id).delete(synchronize_session=False)
    db.query(Holding).filter(Holding.user_id == user.id).delete(synchronize_session=False)
    user.cash_balance = STARTING_CASH
    _replay(db, user)


def demo_trade_price_basis(user: User) -> dict:
    if not user.is_demo:
        return {}
    return {
        (fill["symbol"], fill["side"], fill["date"]): {
            "provider": fill["provider"], "adjustment": fill["adjustment"], "quote_at": fill.get("quote_at"),
        }
        for fill in user.demo_seed["fills"]
    }
