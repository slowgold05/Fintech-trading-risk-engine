"""Bounded close-to-close review of the current portfolio book."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.ledger_entry import LedgerEntry
from app.models.market_bar_daily import MarketBarDaily
from app.models.user import User
from app.schemas.night_portfolio_review import (
    Coverage, Observation, PortfolioReview, ReviewExposure, ReviewMetrics, ReviewPoint, SectorExposure, Window,
)
from app.services.demo_market_history import PriceSeries, seed_price_series
from app.services.exchange_calendar import expected_session_dates
from app.services.history_series import RAW, _series_order
from app.services.market_cache_service import latest_entitled_session
from app.services.market_history import one_calendar_year_before, one_month_before, three_months_before
from app.services.night_portfolio_contribution import period_contribution
from app.services.performance_service import (
    BENCHMARK_SYMBOL, _account_value, _asset_symbols, _cash_flows, _effective_at,
    _establish_index, _flow_since, _next_twr_index, _state_as_of, _states_by_date,
)
from app.services.portfolio_allocation import allocation_from_portfolio
from app.services.portfolio_risk import _defined_index_returns, _paired_index_returns
from app.services.portfolio_valuation import CENT, _naive_utc, _value_portfolio

NEW_YORK = ZoneInfo("America/New_York")
RATIO_UNIT = Decimal("0.00000001")
MIN_SAMPLES = 20
PERIOD_START = {"1m": one_month_before, "3m": three_months_before, "1y": one_calendar_year_before}
PREFERRED_SERIES = _series_order(RAW)


@dataclass(frozen=True)
class Close:
    price: Decimal
    fetched_at: datetime


@dataclass(frozen=True)
class ValuedSession:
    value: Decimal
    index: Decimal | None
    pnl: Decimal | None


def ratio_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    rounded = value.quantize(RATIO_UNIT, rounding=ROUND_HALF_UP)
    return format(rounded if rounded else abs(rounded), "f")


def usd(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _period(clock: datetime, window: Window) -> tuple[date, date]:
    today = clock.astimezone(NEW_YORK).date()
    end = latest_entitled_session(today)
    start = latest_entitled_session(date(today.year, 1, 1)) if window == "ytd" else PERIOD_START[window](end)
    return start, end


def _read_bars(db: Session, symbols: set[str], days: list[date], clock: datetime):
    bars = defaultdict(lambda: defaultdict(dict))
    flagged = defaultdict(set)
    for row in db.scalars(select(MarketBarDaily).where(
        MarketBarDaily.symbol.in_(symbols),
        MarketBarDaily.session_date.in_(days),
        MarketBarDaily.fetched_at <= clock,
    )):
        source = PriceSeries(row.provider, row.adjustment_type)
        if row.quality_status == "valid" and row.close.is_finite() and row.close > 0:
            bars[row.symbol][source][row.session_date] = Close(row.close, row.fetched_at)
        else:
            flagged[(row.symbol, source)].add(row.session_date)
    return bars, flagged


def _select_series(candidates, *, book: bool, pinned: PriceSeries | None = None, endpoints=()):
    """Use the existing provider preference with one source on every date.

    For non-demo account marks, preserve the legacy priority of other raw
    providers ahead of adjusted fallbacks. SPY favors a series that actually
    covers both comparison endpoints before applying provider preference.
    """
    if pinned is not None:
        return pinned if pinned in candidates else None
    if not candidates:
        return None

    def rank(source: PriceSeries):
        key = (source.provider, source.adjustment)
        priority = PREFERRED_SERIES.index(key) if key in PREFERRED_SERIES else len(PREFERRED_SERIES)
        if book and source.adjustment == RAW and key != ("massive", RAW):
            priority = 1
        elif book and priority:
            priority += 1
        closes = candidates[source]
        endpoint_rank = sum(day not in closes for day in endpoints)
        lacks_base = bool(endpoints and endpoints[0] not in closes)
        return (endpoint_rank, lacks_base, priority, -max(closes).toordinal(), source.provider)

    return min(candidates, key=rank)


def _value_sessions(days, entries, boundary, states, symbols, marks):
    values = {}
    used_marks = defaultdict(list)
    flows = _cash_flows(entries, boundary.id if boundary and boundary.event_kind == "reset" else None)
    inception = _effective_at(boundary).date() if boundary is not None else None
    last_day = None
    last_value = None
    last_index = None
    established = sealed = False
    for day in days:
        if inception is None or day < inception:
            continue
        cash, quantities = _state_as_of(states, day)
        value, missing = _account_value(cash, quantities, symbols, marks, day)
        if missing:
            continue
        value = usd(value)
        if last_day is None:
            pnl = None
            index = _establish_index(value)
            established = index is not None
        else:
            flow = _flow_since(flows, last_day, day)
            pnl = usd(value - flow - last_value)
            index, established, sealed = _next_twr_index(
                value, flow, last_value, last_index, established=established, sealed=sealed,
            )
        values[day] = ValuedSession(value, index, pnl)
        for asset_id, quantity in quantities.items():
            if quantity:
                used_marks[symbols[asset_id]].append(day)
        last_day, last_value, last_index = day, value, index
    return values, used_marks, flows


def _paired_moments(left: list[Decimal], right: list[Decimal]):
    n = len(left)
    left_mean, right_mean = sum(left) / n, sum(right) / n
    centered = [(a - left_mean, b - right_mean) for a, b in zip(left, right, strict=True)]
    return (
        sum(a * a for a, _ in centered), sum(b * b for _, b in centered),
        sum(a * b for a, b in centered),
    )


def _daily_statistics(indexes, spies):
    daily = _defined_index_returns(indexes)
    paired_book, paired_spy = _paired_index_returns(indexes, spies)
    volatility = beta = correlation = None
    if len(daily) >= MIN_SAMPLES:
        mean = sum(daily) / len(daily)
        variance = sum((item - mean) ** 2 for item in daily) / (len(daily) - 1)
        volatility = (variance * 252).sqrt()
    if len(paired_spy) >= MIN_SAMPLES:
        book_ss, spy_ss, cross = _paired_moments(paired_book, paired_spy)
        if spy_ss:
            beta = cross / spy_ss
            if book_ss:
                correlation = cross / (book_ss * spy_ss).sqrt()
    return volatility, beta, correlation, len(daily), len(paired_spy)


def _performance_metrics(days, values, spy, start, end, *, ytd: bool, year: int):
    base_close = spy[start].price if start in spy and start != end else None
    comparable = start is not None and end is not None and start != end and (not ytd or end.year == year)
    indexes, spies, drawdowns, points = [], [], [], []
    peak = None
    for day in days:
        index = values[day].index if day in values else None
        # A comparison point always has an observed account valuation and an
        # actual SPY close. Passing nulls preserves gaps in adjacent samples.
        spy_index = (
            spy[day].price if start is not None and day >= start and day in values and day in spy else None
        )
        drawdown = None
        if index is not None:
            peak = index if peak is None else max(peak, index)
            drawdown = index / peak - 1
            drawdowns.append(drawdown)
        indexes.append(index)
        spies.append(spy_index)
        points.append(ReviewPoint(
            session_date=day,
            portfolio_return_ratio=ratio_text(None if index is None else index - 1),
            spy_return_ratio=ratio_text(None if spy_index is None or base_close is None else spy_index / base_close - 1),
            drawdown_ratio=ratio_text(drawdown),
        ))

    portfolio_return = values[end].index - 1 if comparable and values[end].index is not None else None
    spy_return = spy[end].price / base_close - 1 if comparable and base_close is not None and end in spy else None
    excess = portfolio_return - spy_return if portfolio_return is not None and spy_return is not None else None
    vol, beta, corr, daily, paired = _daily_statistics(indexes, spies)
    return ReviewMetrics(
        return_ratio=ratio_text(portfolio_return),
        spy_return_ratio=ratio_text(spy_return),
        excess_return_ratio=ratio_text(excess),
        max_drawdown_ratio=ratio_text(min(drawdowns) if len(drawdowns) > 1 else None),
        annualized_volatility_ratio=ratio_text(vol),
        beta_to_spy=ratio_text(beta),
        correlation_to_spy=ratio_text(corr),
        daily_sample_count=daily,
        paired_sample_count=paired,
    ), points


def _current_allocation(db: Session, portfolio: dict, clock: datetime) -> dict:
    # A cached quote whose fetch time is after the snapshot cannot value this read.
    for position in portfolio["positions"]:
        fetched_at = _naive_utc(position["fetched_at"])
        if position["price_status"] == "available" and (fetched_at is None or fetched_at > clock):
            position.update(price_status="unavailable", unavailable_reason="invalid", position_value=None)
            portfolio["unavailable_symbols"].append(position["symbol"])
            portfolio["summary"]["total_account_value"] = None
    portfolio["unavailable_symbols"].sort()
    return allocation_from_portfolio(db, portfolio)


def _exposure(portfolio, allocation, clock: datetime, latest: date) -> ReviewExposure:
    positions = portfolio["positions"]
    unavailable = allocation["unavailable_symbols"]
    if unavailable:
        if all(position["unavailable_reason"] == "stale" for position in positions):
            coverage = "stale"
        else:
            coverage = "partial" if any(position["price_status"] == "available" for position in positions) else "missing"
    elif any(date.fromisoformat(position["quote_at"][:10]) < latest for position in positions):
        coverage = "stale"
    else:
        coverage = "available"

    def weight(percent):
        if percent is None or not Decimal(allocation["total_account_value"] or "0"):
            return None
        return ratio_text(Decimal(percent) / 100)

    return ReviewExposure(
        as_of=clock, coverage=coverage, cash_weight_ratio=weight(allocation["cash_weight_pct"]),
        sectors=[
            SectorExposure(sector=row["sector"], value_usd=row["value"], weight_ratio=weight(row["weight_pct"]))
            for row in allocation["sectors"] or []
        ],
        unpriced_symbols=unavailable,
    )


def _review_coverage(values, days, start, end, metrics, spy) -> Coverage:
    if len(values) < 2:
        return "missing"
    if end != days[-1]:
        return "stale"
    if start != days[0] or len(values) < len(days) or metrics.return_ratio is None or metrics.spy_return_ratio is None:
        return "partial"
    if any(day not in spy for day in days if start <= day <= end):
        return "partial"
    return "available"


def build_review(db: Session, user_id: int, email: str, window: Window) -> PortfolioReview:
    with consistent_read(db):
        return review_in_snapshot(db, user_id, email, window).review


@dataclass(frozen=True)
class ReviewSnapshot:
    review: PortfolioReview
    values: dict[date, ValuedSession]
    portfolio: dict
    allocation: dict
    spy_source: PriceSeries | None
    spy: dict[date, Close]


def review_in_snapshot(db: Session, user_id: int, email: str, window: Window) -> ReviewSnapshot:
    sampled_at = snapshot_clock(db)
    clock = sampled_at.replace(tzinfo=timezone.utc)
    start, end = _period(clock, window)
    days = expected_session_dates(start, end)
    portfolio = _value_portfolio(db, user_id, email, clock=sampled_at)
    allocation = _current_allocation(db, portfolio, sampled_at)
    user = db.execute(select(User.demo_seed, User.is_demo.label("is_demo")).where(User.id == user_id)).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    seed = user.demo_seed if user.is_demo else None

    entries = list(db.scalars(select(LedgerEntry).where(LedgerEntry.user_id == user_id).order_by(LedgerEntry.id)))
    reset = next((row for row in reversed(entries) if row.event_kind == "reset"), None)
    boundary = reset or next((row for row in entries if row.event_kind == "opening_snapshot"), None)
    states = _states_by_date(entries, reset.id if reset is not None and seed is not None else None)
    symbols = _asset_symbols(db, entries)
    bars, flagged = _read_bars(db, {BENCHMARK_SYMBOL, *symbols.values()}, days, clock)
    pinned = seed_price_series(seed) if seed is not None else {}
    sources = {
        symbol: source
        for symbol in sorted(set(symbols.values()))
        if (source := _select_series(bars[symbol], book=seed is None, pinned=pinned.get(symbol))) is not None
    }
    marks = {
        (symbol, day): [close.price]
        for symbol, source in sources.items() for day, close in bars[symbol][source].items()
    }
    values, used_marks, flows = _value_sessions(days, entries, boundary, states, symbols, marks)
    start_used = next((day for day, item in values.items() if item.index is not None), None)
    end_used = next(reversed(values), None)
    # Keep even a sparse single-source series for partial chart points.
    endpoints = (start_used, end_used) if start_used is not None and start_used != end_used else ()
    spy_source = _select_series(bars[BENCHMARK_SYMBOL], book=False, endpoints=endpoints)
    spy = bars[BENCHMARK_SYMBOL][spy_source] if spy_source is not None else {}
    year = clock.astimezone(NEW_YORK).year
    metrics, points = _performance_metrics(days, values, spy, start_used, end_used, ytd=window == "ytd", year=year)
    missing = [day for day in days if day not in values]
    observations = []
    spy_days = [
        day for day in days
        if start_used is not None and day >= start_used and day in values and day in spy
    ]
    if spy_days:
        observations.append(Observation(
            symbol=BENCHMARK_SYMBOL, provider=spy_source.provider, basis=spy_source.adjustment,
            from_date=spy_days[0], to_date=spy_days[-1],
        ))
    for symbol, dates in sorted(used_marks.items()):
        source = sources[symbol]
        item = Observation(
            symbol=symbol, provider=source.provider, basis=source.adjustment, from_date=dates[0], to_date=dates[-1],
        )
        if item not in observations:
            observations.append(item)
    assumptions = [
        "Expected sessions follow the standard NYSE calendar. The requested end is the latest entitled close.",
        "Account returns use time-weighted ledger values net of external deposits and withdrawals. Unrecorded dividends, fees and taxes are excluded.",
        "SPY is a price-return comparison at the account endpoints. Its series is listed first when observed.",
        "Drawdown uses observed time-weighted peaks. Daily risk uses adjacent expected sessions and exact SPY pairs, with at least 20 observations, sample variance and 252 sessions per year.",
    ]
    if boundary is not None and days and _effective_at(boundary).date() > days[0]:
        assumptions.append("The current book began within or after the requested window. Earlier sessions have no valuation.")
    if missing:
        assumptions.append("Missing account values stay blank. Growth links valued endpoints and excludes external flows across gaps.")
    if start_used is not None and start_used != days[0]:
        assumptions.append("The return starts at the first usable funded observation in the window.")
    if metrics.spy_return_ratio is None:
        assumptions.append("A matched SPY return requires closes from one provider and basis at both account endpoints.")

    contribution = period_contribution(
        db, user_id, entries, states, symbols, sources, bars, flagged, pinned, seed,
        values, flows, start_used, end_used, clock, reset.id if reset is not None else None,
    )
    review = PortfolioReview(
        window=window, read_at=clock, coverage=_review_coverage(values, days, start_used, end_used, metrics, spy),
        requested_start=start, requested_end=end, start_used=start_used, end_used=end_used,
        expected_sessions=len(days), valued_sessions=len(values), missing_sessions=missing,
        observations=observations, metrics=metrics, points=points,
        exposure=_exposure(portfolio, allocation, clock, end), contribution=contribution, assumptions=assumptions,
    )
    return ReviewSnapshot(review, values, portfolio, allocation, spy_source, spy)
