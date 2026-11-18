"""Select stored closes for demo seeding and demo-only historical marks."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.market_bar_daily import MarketBarDaily
from app.models.price_history_daily import PriceHistoryDaily
from app.services.history_series import RAW, select_history_series_by_symbol


@dataclass(frozen=True)
class PriceSeries:
    provider: str
    adjustment: str


def demo_daily_closes(
    db: Session, symbols: set[str], start: date, end: date,
    *, pinned: dict[str, PriceSeries] | None = None, clock: datetime | None = None,
) -> dict[str, tuple[PriceSeries, dict[date, Decimal]]]:
    """Choose one series per symbol and leave gaps in that series unfilled."""
    if not symbols or start > end:
        return {}
    clock = datetime.now(timezone.utc) if clock is None else clock
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    pinned = pinned or {}
    canonical = select_history_series_by_symbol(db, symbols - pinned.keys(), start, end, RAW, clock)
    series = defaultdict(lambda: defaultdict(dict))
    rows = db.execute(select(
        MarketBarDaily.symbol, MarketBarDaily.session_date, MarketBarDaily.close,
        MarketBarDaily.provider, MarketBarDaily.adjustment_type,
    ).where(
        MarketBarDaily.symbol.in_(symbols),
        MarketBarDaily.session_date.between(start, end),
        MarketBarDaily.quality_status == "valid",
        MarketBarDaily.fetched_at <= clock,
    ))
    for symbol, day, close, provider, adjustment in rows:
        series[symbol][PriceSeries(provider, adjustment)][day] = close
    legacy = db.execute(select(
        PriceHistoryDaily.symbol, PriceHistoryDaily.date, PriceHistoryDaily.close, PriceHistoryDaily.source,
    ).where(PriceHistoryDaily.symbol.in_(symbols), PriceHistoryDaily.date.between(start, end)))
    for symbol, day, close, provider in legacy:
        if close.is_finite() and close > 0:
            series[symbol][PriceSeries(provider, "legacy")][day] = close

    selected = {}
    for symbol, candidates in series.items():
        if symbol in pinned:
            source = pinned[symbol]
        elif symbol in canonical:
            source = PriceSeries(*canonical[symbol])
        else:
            source = min(candidates, key=lambda item: (-len(candidates[item]), item.provider))
        if source in candidates:
            selected[symbol] = (source, candidates[source])
    return selected


def seed_price_series(seed: dict) -> dict[str, PriceSeries]:
    return {
        fill["symbol"]: PriceSeries(fill["provider"], fill["adjustment"])
        for fill in seed["fills"] if fill["adjustment"] != "cached_quote"
    }
