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
snapshot of account worth; only the *return ratio* needs the flow removed.

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
    SUPPORTED_RANGES,
    one_calendar_year_before,
    two_calendar_years_before,
)
from app.services.portfolio_valuation import _decimal, _iso_z, _money, _naive_utc, _value_portfolio

TWR_UNIT = Decimal("0.000001")
CENT = Decimal("0.01")


def build_performance_response(db: Session, user_id: int, email: str, range_token: str) -> dict:
    if range_token not in SUPPORTED_RANGES:
        raise HTTPException(status_code=422, detail="range must be 1y or 2y.")
    with consistent_read(db):
        return _performance(db, user_id, email, range_token)


def _performance(db: Session, user_id: int, email: str, range_token: str) -> dict:
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
    flows = _cash_flows(entries)

    series = []
    last_value: Decimal | None = None
    last_index: Decimal | None = None
    last_available_date: date | None = None
    for session_day in series_days:
        cash, quantities = _state_as_of(states, session_day)
        raw_value, missing = _account_value(cash, quantities, symbols, closes, session_day)
        if missing:
            # A gap does not move the base. The next available day chains from
            # the last day that actually had a value, carrying any flow that
            # landed during the gap forward (see _flow_since).
            series.append({
                "session_date": session_day.isoformat(),
                "status": "unavailable",
                "account_value": None,
                "unavailable_symbols": missing,
                "twr_index": None,
            })
            continue
        account = Decimal(_account_text(raw_value))
        if last_value is None:
            index = Decimal("1.000000")
        else:
            flow = _flow_since(flows, last_available_date, session_day)
            index = (last_index * (account - flow) / last_value).quantize(TWR_UNIT, rounding=ROUND_HALF_UP)
        last_value = account
        last_available_date = session_day
        last_index = index
        series.append({
            "session_date": session_day.isoformat(),
            "status": "available",
            "account_value": format(account, "f"),
            "unavailable_symbols": [],
            "twr_index": format(index, "f"),
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
        "series": series,
        "reconciliation": _reconciliation(db, user_id, email, clock, series),
    }


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
    db: Session,
    user_id: int,
    email: str,
    clock: datetime,
    series: list[dict],
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
    portfolio = _value_portfolio(db, user_id, email)
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
