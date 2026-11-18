"""Shared selection for canonical daily series.

Pick a series within the caller's window. Never fill gaps with another series.
Analytics retain the historical ambiguity rule for other raw providers.
"""

from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import case, func, select

from app.models.market_bar_daily import MarketBarDaily as DailyBar

AUTO = "auto"
RAW = "raw"
ADJUSTED = "split_adjusted"
YAHOO_SERIES = ("yahoo", ADJUSTED)


def _series_order(adjustment):
    alternate = RAW if adjustment == ADJUSTED else ADJUSTED
    return (("massive", adjustment), ("massive", alternate), YAHOO_SERIES, ("yahoo", RAW))


def _rank(adjustment):
    return case(
        *(
            ((DailyBar.provider == provider) & (DailyBar.adjustment_type == kind), rank)
            for rank, (provider, kind) in enumerate(_series_order(adjustment))
        ),
        (DailyBar.adjustment_type == adjustment, 4),
        else_=5,
    )


def _usable(clock):
    return (DailyBar.quality_status == "valid", DailyBar.fetched_at <= clock)


def select_history_series(db, symbol, start, end, adjustment, clock):
    return db.execute(
        select(DailyBar.provider, DailyBar.adjustment_type)
        .where(DailyBar.symbol == symbol, DailyBar.session_date.between(start, end), *_usable(clock))
        .group_by(DailyBar.provider, DailyBar.adjustment_type)
        .order_by(_rank(adjustment), func.max(DailyBar.session_date).desc(), DailyBar.provider)
        .limit(1)
    ).first()


def read_analytics_closes(db, symbols, start, end):
    """Prioritize Massive raw, then legacy raw, then a supported adjusted series."""
    by_series = defaultdict(lambda: defaultdict(list))
    adjusted = {}
    rank = _rank(RAW)
    rows = db.execute(
        select(DailyBar.symbol, DailyBar.session_date, DailyBar.close, DailyBar.provider, DailyBar.adjustment_type, rank)
        .where(
            DailyBar.symbol.in_(symbols),
            DailyBar.session_date.between(start, end),
            (DailyBar.adjustment_type == RAW)
            | ((rank < 4) & (DailyBar.quality_status == "valid")),
        )
    )
    for symbol, day, close, provider, adjustment, preference in rows:
        # Keep the original quality/ambiguity semantics for raw analytics.
        priority = 0 if preference == 0 else (1 if adjustment == RAW else preference + 2)
        by_series[symbol][priority].append((day, Decimal(str(close))))
        if adjustment == ADJUSTED:
            adjusted[(symbol, priority)] = provider
    selected = {}
    adjusted_sources = {}
    for symbol, series in by_series.items():
        priority = min(series)
        selected[symbol] = series[priority]
        if (symbol, priority) in adjusted:
            adjusted_sources[symbol] = adjusted[(symbol, priority)]
    return selected, adjusted_sources


def read_history_quotes(db, symbols):
    """Read latest usable daily bars for missing display quotes."""
    if not symbols:
        return {}
    clock = datetime.now(timezone.utc)
    end = clock.date()
    start = end - timedelta(days=14)
    series = (
        select(
            DailyBar.symbol,
            DailyBar.provider,
            DailyBar.adjustment_type,
            func.max(DailyBar.session_date).label("latest"),
            func.row_number().over(
                partition_by=DailyBar.symbol,
                order_by=(_rank(RAW), func.max(DailyBar.session_date).desc(), DailyBar.provider),
            ).label("preference"),
        )
        .where(DailyBar.symbol.in_(symbols), DailyBar.session_date.between(start, end), *_usable(clock))
        .group_by(DailyBar.symbol, DailyBar.provider, DailyBar.adjustment_type)
        .subquery()
    )
    rows = db.scalars(
        select(DailyBar).join(
            series,
            (series.c.symbol == DailyBar.symbol)
            & (series.c.provider == DailyBar.provider)
            & (series.c.adjustment_type == DailyBar.adjustment_type)
            & (series.c.latest == DailyBar.session_date),
        ).where(series.c.preference == 1)
    )
    return {
        row.symbol: SimpleNamespace(
            price=row.close,
            change_amount=row.close - row.open,
            change_percent=(row.close / row.open - 1) * 100,
            volume=row.volume,
            source=row.provider,
            quote_at=datetime.combine(row.session_date, time.min),
            adjustment_type=row.adjustment_type,
        )
        for row in rows
    }
