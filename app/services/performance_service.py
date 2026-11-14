"""Daily account value and time-weighted return from one ledger snapshot.

``account_value`` is cash plus quantity times the single raw daily close.
Money is quantized to cents with ``portfolio_valuation._money`` and then
rendered as decimal text. ``twr_index`` is a growth factor, ``1.000000`` on
the first day that has a value, and six decimal places after that.

``cash_deposit``/``cash_withdrawal`` postings (``cash_movements.post_movement``,
a real, already-shippable route — not a hypothetical future event kind) are
excluded from the return ratio, because new or removed cash is not investment
gain or loss. The sub-period formula is

    flow(d) = sum of signed "cash_deposit"/"cash_withdrawal" amounts (the
              "cash"-account posting only, not its "offset" leg) dated in
              (last_available's date, d's date]
    twr_index(d) = twr_index(last_available) * (account_value(d) - flow(d))
                   / account_value(last_available)

where ``last_available`` is the most recent earlier day in this series that
itself had a value. ``flow`` sums every deposit/withdrawal since
``last_available``, not only ones dated exactly on ``d`` — a flow landing on a
gap day (no computable value that day) is still carried forward and excluded
once the series resumes, rather than polluting the next available day's
return or forcing that day unavailable just because a deposit happened to
land when a price was missing. ``account_value`` itself is unaffected by this
exclusion — it already correctly reflects deposited/withdrawn cash as a real
snapshot of account worth. The return ratio and ``daily_pnl`` both remove
that flow; ``account_value`` does not.

``daily_pnl`` is that same excluded-flow change, in dollars:

    daily_pnl(d) = account_value(d) - flow(d) - account_value(last_available)

quantized to cents (``CENT``), ``ROUND_HALF_UP``, as decimal text. It reuses
the ``flow`` already computed for ``twr_index`` in the same loop, so the two
fields cannot disagree about what counts as external cash. The first available
day has no prior value to diff, so ``daily_pnl`` is null there. A gap day is
null too. ``"0.00"`` is a measured flat day, not a stand-in for "unknown."

``cumulative_pnl`` is that same excluded-flow change, measured from the
series' first available day (the base day, where ``twr_index`` is
``1.000000``) instead of from the previous available day:

    cumulative_pnl(d) = account_value(d) - base_value
                        - _flow_since(flows, base_date, d)

quantized to cents (``CENT``), ``ROUND_HALF_UP``, as decimal text. The flow
anchor is ``base_date``, not ``last_available_date``, so this is a second
``_flow_since`` call — not the ``flow`` already computed for ``twr_index``
and ``daily_pnl``. The base day itself is ``"0.00"``: day zero of its own
measurement, a real zero. A gap day is null.

``drawdown_pct`` is the decline from the running peak ``account_value``
among available days only:

    drawdown_pct(d) = ((peak(d) - account_value(d)) / peak(d)) * 100

quantized to 4 decimal places, ``ROUND_HALF_UP``, as decimal text. A new
high is ``"0.0000"``. A gap day is null and does not move the peak. A peak
of zero has no defined decline, so ``drawdown_pct`` is null. A later positive
value may start the peak. Zero is not stored as a peak and is not reported
as ``"0.0000"``.

``money_weighted_return_pct`` is one Modified Dietz figure for the whole
requested window, a sibling of ``status`` rather than a field on each series
point. It is null when fewer than two days are available (``T`` would be 0)
or when no ``cash_deposit``/``cash_withdrawal`` falls in the inclusive span
``[base_date, last_available_date]`` — including a flow dated on a gap day.
Otherwise, with ``T`` and each flow's ``t`` in calendar days:

    100 * (V_end - V_start - sum(F)) / (V_start + sum(F * (T - t) / T))

quantized to ``DRAWDOWN_UNIT``, ``ROUND_HALF_UP``, as decimal text. A flow on
``base_date`` has weight 1. A flow on ``last_available_date`` has weight 0.
A zero Modified Dietz denominator is undefined, so the figure is null. It is
not reported as zero.

Zero capital does not invent a growth rate. Dollar fields stay numeric,
including zero: ``account_value``, ``daily_pnl``, and ``cumulative_pnl``.
The growth chain is separate. A window that has not yet seen positive
capital leaves ``twr_index`` null. The first positive ``account_value`` may
establish ``twr_index`` ``1.000000``. Daily and cumulative dollars still use
the prior available value, even when that value is zero. After that funded
chain exists, a later interval whose prior available account is zero, or
whose prior index is missing, nonpositive, or rounded to zero, cannot form
a ratio. That interval and every later interval in the same window publish
null. The chain does not restart at ``1.000000`` inside the window. A
missing price is not this break: the next available day still chains from
the last available value. The same rule applies to the SPY index, with the
prior close and prior index as the denominators.

``benchmark_index`` is a fixed ``"SPY"`` price-return chain. It uses the same
sub-period ratio and ``TWR_UNIT`` rounding as ``twr_index``, and no flow term,
because a benchmark close has no deposits:

    benchmark_index(d) = benchmark_index(last_spy_available)
                         * C_SPY(d) / C_SPY(last_spy_available)

The first series day with exactly one raw SPY close is ``1.000000``. Zero
closes, or more than one provider row, is null and does not move
``last_spy_available``. The chain does not look at the account's own
availability, so SPY can be known on an account gap and the account can be
known on a SPY gap.

``opening_snapshot`` and ``reset`` are inception boundaries, not flows inside
a sub-period. The series starts at the latest ``reset``, or at
``opening_snapshot`` when the account has never been reset — the same latest-
reset boundary ``_realized_subquery`` uses. Reset postings are deltas against
the prior running balance (see ``append_reset``). Cash and quantity as of a
day on or after inception are therefore the sum of every posting through that
day's end, including pre-reset postings the reset closes out. Days before
inception are outside the window, so those trades do not appear in the series.
"""

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
import bisect

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.read_snapshot import SnapshotClockError, consistent_read, snapshot_clock
from app.models.asset import Asset
from app.models.ledger_entry import LedgerEntry
from app.models.market_bar_daily import MarketBarDaily
from app.models.user import User
from app.services import exchange_calendar
from app.services.market_history import (
    one_calendar_year_before,
    two_calendar_years_before,
)
from app.services.portfolio_valuation import _decimal, _iso_z, _money, _naive_utc, _value_portfolio

TWR_UNIT = Decimal("0.000001")
DRAWDOWN_UNIT = Decimal("0.0001")
CENT = Decimal("0.01")
# Fixed for this unit. A choice of benchmark is a later change.
BENCHMARK_SYMBOL = "SPY"
# Performance and risk windows. Chart ranges 1m, 3m, 6m, and all stay on
# market_history.SUPPORTED_RANGES and are not accepted here.
PERFORMANCE_RANGES = frozenset({"1y", "2y"})


def require_performance_range(range_token: str) -> None:
    """Reject every token other than ``1y`` and ``2y``, including chart ranges."""
    if range_token not in PERFORMANCE_RANGES:
        raise HTTPException(status_code=422, detail="range must be 1y or 2y.")


def build_performance_response(db: Session, user_id: int, email: str, range_token: str) -> dict:
    require_performance_range(range_token)
    with consistent_read(db):
        return _performance(db, user_id, email, range_token)


def _performance(
    db: Session,
    user_id: int,
    email: str,
    range_token: str,
    clock: datetime | None = None,
    portfolio: dict | None = None,
) -> dict:
    """Read the performance window. ``clock`` and ``portfolio`` reuse one outer snapshot.

    Callers that already sampled ``snapshot_clock`` pass that instant. Passing
    ``portfolio`` from ``_value_portfolio`` skips a second valuation in the
    reconciliation. The public wrapper samples and values inside its own
    ``consistent_read``.
    """
    require_performance_range(range_token)
    if clock is None:
        try:
            clock = snapshot_clock(db)
        except SnapshotClockError as exc:
            raise HTTPException(status_code=500, detail="Portfolio snapshot time is missing.") from exc

    # Same 404 as today's valuation. Auth already rejected an unknown token.
    known = db.execute(select(User.id).where(User.id == user_id)).first()
    if known is None:
        raise HTTPException(status_code=404, detail="User not found")

    requested_end = clock.date()
    requested_start = (
        one_calendar_year_before(requested_end)
        if range_token == "1y"
        else two_calendar_years_before(requested_end)
    )
    entries = list(
        db.execute(
            select(LedgerEntry)
            .where(LedgerEntry.user_id == user_id)
            .order_by(LedgerEntry.id.asc())
        ).scalars()
    )
    inception = _inception_at(entries)
    series_days = [] if inception is None else _series_days(requested_start, requested_end, inception.date())
    states = _states_by_date(entries)
    symbols = _asset_symbols(db, entries)
    closes = _raw_closes(db, symbols, series_days)
    # Own chain, own query. Not folded into `closes`: SPY is reported even
    # when the account does not hold it, and a missing account value does not
    # skip a SPY close.
    benchmark_by_date = _benchmark_index_by_date(db, series_days)
    flows = _cash_flows(entries)

    series = []
    last_value: Decimal | None = None
    last_index: Decimal | None = None
    last_available_date: date | None = None
    peak: Decimal | None = None
    base_value: Decimal | None = None
    base_date: date | None = None
    # Set only after a funded chain cannot form another ratio. Later capital
    # in this window does not open a new index at 1.
    index_sealed = False
    index_established = False
    for session_day in series_days:
        cash, quantities = _state_as_of(states, session_day)
        raw_value, missing = _account_value(cash, quantities, symbols, closes, session_day)
        # Absence in the precomputed map is null. This lookup is not gated on
        # `missing`: the account chain and the SPY chain skip different days.
        benchmark_index = benchmark_by_date.get(session_day)
        if missing:
            # A gap does not move the base, the running peak, or a sealed
            # chain. The next available day chains from the last day that
            # actually had a value, carrying any flow that landed during the
            # gap forward (see _flow_since).
            series.append({
                "session_date": session_day.isoformat(),
                "status": "unavailable",
                "account_value": None,
                "unavailable_symbols": missing,
                "twr_index": None,
                "drawdown_pct": None,
                "daily_pnl": None,
                "cumulative_pnl": None,
                "benchmark_index": benchmark_index,
            })
            continue
        account = Decimal(_account_text(raw_value))
        if last_value is None:
            # No prior available day yet, so there is nothing to diff.
            daily_pnl = None
            # Day zero of this series: a measured zero, not unknown.
            base_value = account
            base_date = session_day
            cumulative_pnl = Decimal("0.00")
            index = _establish_index(account) if account > 0 else None
            index_established = index is not None
        else:
            flow = _flow_since(flows, last_available_date, session_day)
            # Dollar change does not divide. A zero prior value stays numeric.
            daily_pnl = (account - flow - last_value).quantize(CENT, rounding=ROUND_HALF_UP)
            # Anchored at the base day, not last_available. A different window
            # than `flow` above, so this is a second call.
            cumulative_pnl = (
                account - base_value - _flow_since(flows, base_date, session_day)
            ).quantize(CENT, rounding=ROUND_HALF_UP)
            index, index_established, index_sealed = _next_twr_index(
                account,
                flow,
                last_value,
                last_index,
                established=index_established,
                sealed=index_sealed,
            )
        last_value = account
        last_available_date = session_day
        last_index = index
        drawdown, peak = _drawdown(account, peak)
        series.append({
            "session_date": session_day.isoformat(),
            "status": "available",
            "account_value": format(account, "f"),
            "unavailable_symbols": [],
            "twr_index": None if index is None else format(index, "f"),
            "drawdown_pct": None if drawdown is None else format(drawdown, "f"),
            "daily_pnl": None if daily_pnl is None else format(daily_pnl, "f"),
            "cumulative_pnl": format(cumulative_pnl, "f"),
            "benchmark_index": benchmark_index,
        })

    status = "complete" if all(point["status"] == "available" for point in series) else "incomplete"
    return {
        "user": {"id": user_id, "email": email},
        "range": range_token,
        "requested_start": requested_start.isoformat(),
        "requested_end": requested_end.isoformat(),
        "inception_at": None if inception is None else _iso_z(inception),
        "read_at": _iso_z(clock),
        "status": status,
        "money_weighted_return_pct": _money_weighted_return_pct(
            flows, base_date, base_value, last_available_date, last_value,
        ),
        "series": series,
        "reconciliation": _reconciliation(
            clock,
            series,
            portfolio if portfolio is not None else _value_portfolio(db, user_id, email, clock=clock),
        ),
    }


def _establish_index(account: Decimal) -> Decimal | None:
    """First positive capital in the window. Zero does not fabricate a return."""
    if account <= 0:
        return None
    return Decimal("1.000000")


def _next_twr_index(
    account: Decimal,
    flow: Decimal,
    last_value: Decimal,
    last_index: Decimal | None,
    *,
    established: bool,
    sealed: bool,
) -> tuple[Decimal | None, bool, bool]:
    """Next growth factor, plus whether the chain is established or sealed.

    Before the first positive value, a later positive observation may still
    start the index at 1. After the chain is funded, a zero prior account or
    a missing, nonpositive, or rounded-zero prior index seals the rest of
    the window instead of rebasing.
    """
    if sealed:
        return None, established, True
    if not established:
        index = _establish_index(account)
        return index, index is not None, False
    if last_value <= 0 or last_index is None or last_index <= 0:
        return None, True, True
    index = (last_index * (account - flow) / last_value).quantize(TWR_UNIT, rounding=ROUND_HALF_UP)
    return index, True, False


def _drawdown(account: Decimal, peak: Decimal | None) -> tuple[Decimal | None, Decimal | None]:
    """Decline from a positive peak. A zero peak is undefined, not 0%."""
    if account > 0 and (peak is None or account > peak):
        peak = account
    if peak is None or peak <= 0:
        return None, peak
    drawdown = ((peak - account) / peak * 100).quantize(DRAWDOWN_UNIT, rounding=ROUND_HALF_UP)
    return drawdown, peak


def _inception_at(entries: list[LedgerEntry]) -> datetime | None:
    """Latest reset ``created_at``, else the opening snapshot. Mirrors max(reset id)."""
    reset_id = None
    reset_at = None
    opening_at = None
    for entry in entries:
        if entry.event_kind == "reset":
            if reset_id is None or entry.id > reset_id:
                reset_id = entry.id
                reset_at = entry.created_at
        elif entry.event_kind == "opening_snapshot" and opening_at is None:
            opening_at = entry.created_at
    chosen = reset_at if reset_at is not None else opening_at
    if chosen is None:
        return None
    parsed = _naive_utc(chosen)
    if parsed is None:
        raise HTTPException(status_code=500, detail="Ledger entry time is missing.")
    return parsed


def _series_days(requested_start: date, requested_end: date, inception_date: date) -> list[date]:
    """Trading days on or after inception, clipped to the requested window."""
    if inception_date > requested_end:
        return []
    window_start = requested_start if inception_date < requested_start else inception_date
    if window_start > requested_end:
        return []
    return exchange_calendar.expected_session_dates(window_start, requested_end)


def _states_by_date(entries: list[LedgerEntry]) -> dict[date, tuple[Decimal, dict[int, Decimal]]]:
    """End-of-day cash and position quantity after every posting dated that UTC day."""
    cash = Decimal(0)
    quantities: dict[int, Decimal] = defaultdict(Decimal)
    states: dict[date, tuple[Decimal, dict[int, Decimal]]] = {}
    for entry in entries:
        stamp = _naive_utc(entry.created_at)
        if stamp is None:
            raise HTTPException(status_code=500, detail="Ledger entry time is missing.")
        amount = _decimal(entry.amount)
        if entry.account == "cash":
            cash += amount
        elif entry.account == "position" and entry.asset_id is not None:
            quantities[entry.asset_id] += amount
        states[stamp.date()] = (cash, dict(quantities))
    return states


def _state_as_of(
    states: dict[date, tuple[Decimal, dict[int, Decimal]]],
    session_day: date,
) -> tuple[Decimal, dict[int, Decimal]]:
    if not states:
        return Decimal(0), {}
    dates = sorted(states)
    index = bisect.bisect_right(dates, session_day) - 1
    if index < 0:
        return Decimal(0), {}
    return states[dates[index]]


def _cash_flows(entries: list[LedgerEntry]) -> list[tuple[date, Decimal]]:
    """Signed deposit/withdrawal amounts by date, cash-account leg only.

    Each cash_deposit/cash_withdrawal event posts two balanced rows
    (``"cash"`` and ``"offset"``, equal and opposite) — only the ``"cash"``
    leg is a real flow; summing both would always cancel to zero.
    """
    flows: list[tuple[date, Decimal]] = []
    for entry in entries:
        if entry.account != "cash" or entry.event_kind not in ("cash_deposit", "cash_withdrawal"):
            continue
        stamp = _naive_utc(entry.created_at)
        if stamp is None:
            raise HTTPException(status_code=500, detail="Ledger entry time is missing.")
        flows.append((stamp.date(), _decimal(entry.amount)))
    flows.sort(key=lambda item: item[0])
    return flows


def _flow_since(flows: list[tuple[date, Decimal]], after: date | None, through: date) -> Decimal:
    """Sum of signed flows dated in (after, through], or all flows through `through` if after is None."""
    total = Decimal(0)
    for flow_date, amount in flows:
        if flow_date > through:
            break
        if after is None or flow_date > after:
            total += amount
    return total


def _money_weighted_return_pct(
    flows: list[tuple[date, Decimal]],
    base_date: date | None,
    base_value: Decimal | None,
    last_available_date: date | None,
    last_value: Decimal | None,
) -> str | None:
    """Modified Dietz for [base_date, last_available_date], inclusive of both ends.

    ``_flow_since`` excludes its start date. This window does not: a flow on
    ``base_date`` was invested for the whole period. ``flows`` is sorted by
    date, so the scan can stop at the first flow past ``last_available_date``.
    """
    if base_date is None or last_available_date is None or base_date == last_available_date:
        return None
    # Calendar days. Equal dates are already rejected above, so this is >= 1.
    period = (last_available_date - base_date).days
    span = Decimal(period)
    total_flow = Decimal(0)
    weighted_flow = Decimal(0)
    saw_flow = False
    for flow_date, amount in flows:
        if flow_date < base_date:
            continue
        if flow_date > last_available_date:
            break
        saw_flow = True
        elapsed = (flow_date - base_date).days
        weight = Decimal(period - elapsed) / span
        total_flow += amount
        weighted_flow += amount * weight
    if not saw_flow:
        return None
    numerator = last_value - base_value - total_flow
    denominator = base_value + weighted_flow
    # Exact zero cannot be a rate. Do not substitute 0%.
    if denominator == 0:
        return None
    pct = (numerator / denominator * 100).quantize(DRAWDOWN_UNIT, rounding=ROUND_HALF_UP)
    return format(pct, "f")


def _asset_symbols(db: Session, entries: list[LedgerEntry]) -> dict[int, str]:
    asset_ids = {
        entry.asset_id
        for entry in entries
        if entry.account == "position" and entry.asset_id is not None
    }
    if not asset_ids:
        return {}
    rows = db.execute(select(Asset.id, Asset.symbol).where(Asset.id.in_(asset_ids))).all()
    return {row.id: row.symbol for row in rows}


def _raw_closes(
    db: Session,
    symbols: dict[int, str],
    series_days: list[date],
) -> dict[tuple[str, date], list[Decimal]]:
    """One query for every raw close the window might need. More than one provider row is kept."""
    if not symbols or not series_days:
        return {}
    rows = db.execute(
        select(
            MarketBarDaily.symbol,
            MarketBarDaily.session_date,
            MarketBarDaily.close,
        ).where(
            MarketBarDaily.symbol.in_(set(symbols.values())),
            MarketBarDaily.adjustment_type == "raw",
            MarketBarDaily.session_date >= series_days[0],
            MarketBarDaily.session_date <= series_days[-1],
        )
    ).all()
    grouped: dict[tuple[str, date], list[Decimal]] = defaultdict(list)
    for row in rows:
        session_day = _as_date(row.session_date)
        if session_day is None:
            continue
        grouped[(row.symbol, session_day)].append(_decimal(row.close))
    return grouped


def _benchmark_index_by_date(db: Session, series_days: list[date]) -> dict[date, str]:
    """SPY raw-close chain for series days that have exactly one raw close.

    Same ratio and ``TWR_UNIT`` rounding as ``twr_index``, with no flow
    exclusion. ``last_spy_value`` / ``last_spy_index`` are local to this walk.
    A day with no unambiguous close is left out of the map (callers ``.get``
    it and treat absence as null) and does not move the chain forward. More
    than one provider row is missing, the same rule as ``_account_value``.
    """
    if not series_days:
        return {}
    # Reuse the held-asset query. The map key is not an asset id; only the
    # symbol value is read.
    closes = _raw_closes(db, {-1: BENCHMARK_SYMBOL}, series_days)
    indexed: dict[date, str] = {}
    last_spy_value: Decimal | None = None
    last_spy_index: Decimal | None = None
    sealed = False
    for session_day in series_days:
        matches = closes.get((BENCHMARK_SYMBOL, session_day), [])
        if len(matches) != 1:
            # A missing or ambiguous close does not move or restart the chain.
            continue
        close = matches[0]
        if sealed:
            continue
        if last_spy_value is None:
            # A zero print does not establish the index. A later positive close may.
            if close <= 0:
                continue
            index = Decimal("1.000000")
        elif last_spy_value <= 0 or last_spy_index is None or last_spy_index <= 0:
            sealed = True
            continue
        else:
            index = (last_spy_index * close / last_spy_value).quantize(TWR_UNIT, rounding=ROUND_HALF_UP)
        last_spy_value = close
        last_spy_index = index
        indexed[session_day] = format(index, "f")
    return indexed


def _account_value(
    cash: Decimal,
    quantities: dict[int, Decimal],
    symbols: dict[int, str],
    closes: dict[tuple[str, date], list[Decimal]],
    session_day: date,
) -> tuple[Decimal | None, list[str]]:
    securities = Decimal(0)
    missing: list[str] = []
    for asset_id, quantity in quantities.items():
        if quantity == 0:
            continue
        symbol = symbols.get(asset_id)
        if symbol is None:
            raise HTTPException(status_code=500, detail="Portfolio asset is missing.")
        matches = closes.get((symbol, session_day), [])
        # Zero rows and two providers are the same outcome: no single raw close.
        if len(matches) != 1:
            missing.append(symbol)
            continue
        securities += quantity * matches[0]
    if missing:
        return None, sorted(set(missing))
    return cash + securities, []


def _account_text(value: Decimal) -> str:
    """Cents, same rounding as today's valuation, as decimal text."""
    return format(Decimal(str(_money(value))), ".2f")


def _reconciliation(
    clock: datetime,
    series: list[dict],
    portfolio: dict,
) -> dict | None:
    """Compare the series to today's valuation only when the series actually reaches today."""
    if not series:
        return None
    today = clock.date()
    if not exchange_calendar.is_nyse_trading_day(today):
        return None
    last = series[-1]
    if last["session_date"] != today.isoformat() or last["status"] != "available":
        return None
    current = portfolio["summary"]["total_account_value"]
    latest_value = last["account_value"]
    if current is None:
        current_text = None
        matches = False
    else:
        current_text = format(Decimal(str(current)).quantize(CENT, rounding=ROUND_HALF_UP), "f")
        matches = current_text == latest_value
    return {
        "latest_series_date": last["session_date"],
        "latest_series_value": latest_value,
        "current_total_account_value": current_text,
        "matches": matches,
    }


def _as_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None
