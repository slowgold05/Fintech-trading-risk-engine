"""Read-only projections of stored split-adjusted closes."""

from collections import defaultdict
from datetime import date, time, timezone
from decimal import ROUND_HALF_UP, Context, Decimal, localcontext
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.schemas.night_simulations import BacktestRequest, Simulation, SimulationPoint, SimulationSource
from app.services.exchange_calendar import expected_session_dates
from app.services.history_series import ADJUSTED

_NEW_YORK = ZoneInfo("America/New_York")
_REGULAR_CLOSE = time(16)
_CENT = Decimal("0.01")
_RATIO = Decimal("0.000001")
_ASSUMPTIONS = (
    "The initial investment buys fractional shares at the first usable split-adjusted close.",
    "Values use observed closes from one provider. Missing sessions have no trades or valuations.",
    "Fees, dividends, taxes and slippage are excluded.",
    "Price return is the underlying change from the first to the last close, expressed as a ratio.",
    "Coverage uses the standard NYSE schedule, which may omit one-off closures.",
)


def _read_closes(db: Session, request: BacktestRequest, expected: set[date]) -> list[MarketBarDaily]:
    clock = snapshot_clock(db).replace(tzinfo=timezone.utc)
    exchange_now = clock.astimezone(_NEW_YORK)
    if request.end > exchange_now.date():
        raise HTTPException(422, detail={"code": "invalid_request", "message": "End must not be in the future.",
                                         "fields": {"end": "Choose today or an earlier date."}})
    if db.get(MarketSymbol, request.symbol) is None:
        raise HTTPException(404, detail={"code": "unknown_symbol", "message": "Unknown symbol."})

    eligible = expected
    if exchange_now.time() < _REGULAR_CLOSE:
        eligible = expected - {exchange_now.date()}

    rows = db.scalars(
        select(MarketBarDaily)
        .where(
            MarketBarDaily.symbol == request.symbol,
            MarketBarDaily.session_date.between(request.start, request.end),
            MarketBarDaily.adjustment_type == ADJUSTED,
            MarketBarDaily.quality_status == "valid",
            MarketBarDaily.fetched_at <= clock,
        )
        .order_by(MarketBarDaily.session_date)
    )
    series = defaultdict(list)
    for bar in rows:
        if bar.session_date in eligible and bar.close.is_finite() and bar.close > 0:
            series[bar.provider].append(bar)

    # Choose the most complete eligible series, using provider name to break ties.
    # Never splice providers to satisfy a missing trade or valuation.
    if not series:
        return []
    provider = min(series, key=lambda name: (-len(series[name]), name))
    return series[provider]


def run_backtest(db: Session, request: BacktestRequest) -> Simulation:
    expected = set(expected_session_dates(request.start, request.end))
    assumptions = list(_ASSUMPTIONS)
    with consistent_read(db):
        bars = _read_closes(db, request, expected)
        if len(bars) < 2:
            return Simulation(
                symbol=request.symbol,
                mode="backtest",
                coverage="missing",
                assumptions=[*assumptions, f"At least two usable sessions are required. Found {len(bars)}."],
            )

        coverage = "available" if len(bars) == len(expected) else "partial"
        assumptions.append(f"Used {len(bars)} of {len(expected)} expected sessions in the requested window.")
        first, last = bars[0], bars[-1]
        with localcontext(Context(prec=50, rounding=ROUND_HALF_UP)):
            contributed = request.initial_usd.quantize(_CENT)
            # Multiply before dividing by the entry close to preserve half-cent ties.
            points = [
                SimulationPoint(
                    session_date=bar.session_date,
                    value_usd=(contributed * bar.close / first.close).quantize(_CENT),
                    contributed_usd=contributed,
                )
                for bar in bars
            ]
            price_return = ((last.close - first.close) / first.close).quantize(_RATIO)
            if price_return.is_zero():
                price_return = abs(price_return)

        fetched_at = last.fetched_at
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        return Simulation(
            symbol=request.symbol,
            mode="backtest",
            coverage=coverage,
            source=SimulationSource(provider=last.provider, session_date=last.session_date,
                                    observed_at=fetched_at.astimezone(timezone.utc), coverage=coverage),
            start_used=first.session_date,
            end_used=last.session_date,
            contributed_usd=points[-1].contributed_usd,
            end_value_usd=points[-1].value_usd,
            price_return=price_return,
            points=points,
            assumptions=assumptions,
        )
