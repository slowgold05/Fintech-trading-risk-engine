"""Align up to four cached split-adjusted price series on a common session grid."""

from collections import defaultdict
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.market_bar_daily import MarketBarDaily as Bar
from app.schemas.night_market import Compare, CompareSeries, Provenance
from app.services.exchange_calendar import expected_session_dates
from app.services.history_series import ADJUSTED, AUTO
from app.services.market_history import one_calendar_year_before, one_month_before, three_months_before
from app.services.night_market_common import market_error, normalize_symbol, price_return, require_symbols, utc
from app.services.night_market_prices import usable_bars

_RANGE_START = {"1m": one_month_before, "3m": three_months_before, "1y": one_calendar_year_before}


def _parse_symbols(raw: str) -> list[str]:
    parts = raw.split(",")
    if 2 <= len(parts) <= 4:
        symbols = [normalize_symbol(part, "symbols") for part in parts]
        if len(symbols) == len(set(symbols)):
            return symbols
    message = "Provide two to four distinct symbols separated by commas."
    raise market_error(422, "invalid_request", message, {"symbols": message})


def _missing_compare(
    symbols: list[str], provider: str, start: date | None = None, end: date | None = None,
) -> Compare:
    return Compare(
        coverage="missing", base_date=None, dates=[], requested_start=start, requested_end=end,
        series=[
            CompareSeries(
                symbol=symbol, returns=[], missing_sessions=0,
                source=Provenance(
                    provider=provider if provider != AUTO else "unavailable", basis=ADJUSTED,
                    session_date=None, observed_at=None, coverage="missing",
                ),
            )
            for symbol in symbols
        ],
    )


def _calendar_grid(start: date, end: date) -> set[date]:
    try:
        return set(expected_session_dates(start, end))
    except ValueError:
        # Outside the supported calendar years, keep the observed-date grid.
        return set()


def read_compare(db: Session, *, symbols: str, range_token: str, provider: str) -> Compare:
    tickers = _parse_symbols(symbols)
    with consistent_read(db):
        require_symbols(db, tickers)
        eligible = [Bar.symbol.in_(tickers), Bar.adjustment_type == ADJUSTED, *usable_bars(snapshot_clock(db))]
        if provider != AUTO:
            eligible.append(Bar.provider == provider)
        end = db.scalar(select(func.max(Bar.session_date)).where(*eligible))
        if end is None:
            return _missing_compare(tickers, provider)

        start = _RANGE_START[range_token](end)
        rows = db.execute(
            select(Bar.symbol, Bar.provider, Bar.session_date, Bar.close, Bar.fetched_at)
            .where(*eligible, Bar.session_date.between(start, end))
        )
        by_provider = defaultdict(lambda: defaultdict(dict))
        for row in rows:
            by_provider[row.provider][row.symbol][row.session_date] = row

        shared_by_provider = {}
        for name, history in by_provider.items():
            shared = set.intersection(*(set(history[ticker]) for ticker in tickers))
            if shared:
                shared_by_provider[name] = shared
        if not shared_by_provider:
            return _missing_compare(tickers, provider, start, end)

        # Maximize jointly usable dates. On ties prefer the existing canonical providers.
        selected = min(
            shared_by_provider,
            key=lambda name: (-len(shared_by_provider[name]), name != "massive", name != "yahoo", name),
        )
        history = by_provider[selected]
        base = min(shared_by_provider[selected])
        grid = _calendar_grid(start, end).union(*(set(history[ticker]) for ticker in tickers))
        dates = sorted(day for day in grid if day >= base)
        series = []
        for ticker in tickers:
            points = history[ticker]
            base_close = points[base].close
            returns = [price_return(points[day].close, base_close) if day in points else None for day in dates]
            series.append(CompareSeries(
                symbol=ticker, returns=returns, missing_sessions=returns.count(None),
                source=Provenance(
                    provider=selected, basis=ADJUSTED, session_date=max(points),
                    observed_at=utc(max(points[day].fetched_at for day in dates if day in points)),
                    coverage="available" if points.keys() == grid else "partial",
                ),
            ))

        return Compare(
            coverage="available" if all(row.source.coverage == "available" for row in series) else "partial",
            base_date=base, dates=dates, series=series, requested_start=start, requested_end=end,
        )
