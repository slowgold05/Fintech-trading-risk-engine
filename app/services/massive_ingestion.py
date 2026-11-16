"""Write Massive grouped-daily bars into canonical history.

The default client calls Massive. That client paces requests and retries HTTP
429 with a bounded wait. Tests pass a fake ``http_get``, which is not paced.
Nothing here is registered with the scheduler.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.market_bar_daily import MarketBarDaily
from app.services.exchange_calendar import expected_session_dates, is_nyse_trading_day
from app.services.market_history import two_calendar_years_before
from app.services.market_providers import ProviderUnavailable, fetch_massive_grouped
from app.services.market_quality import Bar, check_bars
from app.services.massive_client import http_get_massive

_NYSE = ZoneInfo("America/New_York")
# Skips that stored nothing. already_stored is not in this set: those sessions
# have bars, so coverage still counts them.
_NO_DATA_SKIPS = frozenset({"market_closed", "not_yet_available"})

# Mirrors ck_market_bars_daily_prices: strictly below one trillion, strictly above zero.
_PRICE_CEILING = Decimal("1000000000000")
_PROVIDER = "massive"
_ADJUSTMENT = "raw"


def nyse_calendar_today() -> date:
    """Today's date in New York, the clock an NYSE session uses."""
    return datetime.now(_NYSE).date()


def latest_finished_nyse_session(today: date) -> date:
    """Last standard NYSE session strictly before ``today``.

    Grouped bars for a session are not treated as published on that session's
    own date. This walk uses the fixed holiday calendar, so it does not know
    about a one-off closure.
    """
    cursor = today - timedelta(days=1)
    for _ in range(14):
        if is_nyse_trading_day(cursor):
            return cursor
        cursor -= timedelta(days=1)
    raise ValueError(f"no NYSE session before {today.isoformat()}")


def empty_session_skip_reason(day: date, today: date) -> str:
    """Why an empty grouped payload should be skipped.

    ``market_closed`` is only for a session strictly before the latest finished
    NYSE session. That date can be remembered. The latest finished session, and
    anything newer, may simply be unpublished, so the reason is
    ``not_yet_available`` and the caller must request it again.
    """
    if day < latest_finished_nyse_session(today):
        return "market_closed"
    return "not_yet_available"


def ingest_one_day(db, day, symbols, api_key, http_get=http_get_massive, *, today: date | None = None) -> dict:
    """Fetch one grouped day, quality-check the requested symbols, and upsert them.

    ``today`` is the New York calendar date used to decide whether an empty
    payload is a closed session or a file that is not published yet. It defaults
    to the current New York date.
    """
    fetched = fetch_massive_grouped(day, api_key, http_get)
    requested = [str(symbol).upper() for symbol in symbols]
    if not fetched:
        as_of = nyse_calendar_today() if today is None else today
        reason = empty_session_skip_reason(day, as_of)
        return {
            "day": day.isoformat(),
            "requested": len(symbols),
            "written_valid": 0,
            "written_flagged": 0,
            "rejected": [],
            "missing": [] if reason == "market_closed" else list(dict.fromkeys(requested)),
            "skipped": True,
            "skip_reason": reason,
        }
    wanted = set(requested)
    by_symbol: dict[str, Bar] = {}
    for bar in fetched:
        if bar.symbol in wanted:
            by_symbol[bar.symbol] = bar
    filtered = [by_symbol[symbol] for symbol in dict.fromkeys(requested) if symbol in by_symbol]

    # check_bars only compares bars it is given. The previous stored close has
    # to be in that list, or a one-day jump against canonical history is invisible.
    # symbols and as_of stay the filtered set and this session date.
    db.flush()
    findings = check_bars(
        [*_latest_prior_bars(db, [bar.symbol for bar in filtered], day), *filtered],
        symbols=[bar.symbol for bar in filtered],
        as_of=day,
    )
    flagged = {item["symbol"] for item in findings}

    written_valid = 0
    written_flagged = 0
    rejected: list[str] = []
    for bar in filtered:
        # Skip rows the table would reject. Do not attempt the insert and catch
        # the constraint error: a failed flush aborts the whole session.
        if _fails_table_checks(bar):
            rejected.append(bar.symbol)
            continue
        quality_status = "flagged" if bar.symbol in flagged else "valid"
        _upsert_daily_bar(db, bar, quality_status)
        if quality_status == "flagged":
            written_flagged += 1
        else:
            written_valid += 1
    db.flush()

    present = set(by_symbol)
    missing = [symbol for symbol in dict.fromkeys(requested) if symbol not in present]
    return {
        "day": day.isoformat(),
        "requested": len(symbols),
        "written_valid": written_valid,
        "written_flagged": written_flagged,
        "rejected": rejected,
        "missing": missing,
    }


def backfill_two_years(
    db,
    symbols,
    api_key,
    *,
    http_get=http_get_massive,
    today=None,
    commit_each: bool = False,
    on_day=None,
    closed_dates: set[date] | None = None,
) -> dict:
    """Ingest every NYSE session from two calendar years before ``today`` through ``today``.

    The real client paces at the free-plan limit. A fake ``http_get`` does not.
    A session that already has stored Massive raw bars for the requested
    symbols is skipped, so a rerun resumes. One finished day can hold fewer
    symbols than a later day when a ticker was not listed yet. An empty grouped
    response is a closed session only when that date is strictly before the
    latest finished NYSE session. It is then added to ``closed_dates`` when
    that set is passed in. An empty response for the latest finished session,
    or any newer date, is ``not_yet_available``: it is a gap for this run and
    is not remembered, so the next run requests it again. ``commit_each``
    commits after every session; use it for a long local run so a crash keeps
    the days already stored.
    """
    end = nyse_calendar_today() if today is None else today
    sessions = expected_session_dates(two_calendar_years_before(end), end)
    requested = [str(symbol).upper() for symbol in symbols]
    stored = _stored_symbols_by_day(db, requested, sessions)
    skip = _dates_to_skip(stored)
    remembered = closed_dates if closed_dates is not None else set()
    per_day = []
    for session_day in sessions:
        if session_day in remembered:
            report = _skipped_day(session_day, symbols, set(), reason="market_closed")
        elif session_day in skip:
            report = _skipped_day(session_day, symbols, stored.get(session_day, set()))
        else:
            try:
                report = ingest_one_day(
                    db, session_day, symbols, api_key, http_get=http_get, today=end,
                )
            except (ProviderUnavailable, ValueError) as exc:
                # A malformed/incomplete payload (parse_massive_grouped) raises
                # ValueError, not ProviderUnavailable. Either way, one bad day
                # must not abort the whole two-year backfill. Record it as a
                # fully-missing session (every requested symbol in its gaps) and
                # move on to the next day. The client's own 429 retries are
                # already finished before this exception is raised.
                report = {
                    "day": session_day.isoformat(),
                    "requested": len(symbols),
                    "written_valid": 0,
                    "written_flagged": 0,
                    "rejected": [],
                    "missing": list(dict.fromkeys(requested)),
                    "error": str(exc),
                }
            else:
                if report.get("skip_reason") == "market_closed":
                    remembered.add(session_day)
        per_day.append(report)
        if on_day is not None:
            on_day(report)
        if commit_each:
            db.commit()
    return _coverage(symbols, per_day)


def _stored_symbols_by_day(db: Session, symbols: list[str], sessions: list[date]) -> dict[date, set[str]]:
    """Massive raw symbols already stored for each session in the window."""
    unique = list(dict.fromkeys(symbols))
    if not unique or not sessions:
        return {}
    rows = (
        db.query(MarketBarDaily.session_date, MarketBarDaily.symbol)
        .filter(
            MarketBarDaily.symbol.in_(unique),
            MarketBarDaily.provider == _PROVIDER,
            MarketBarDaily.adjustment_type == _ADJUSTMENT,
            MarketBarDaily.session_date >= sessions[0],
            MarketBarDaily.session_date <= sessions[-1],
            MarketBarDaily.quality_status.in_(("valid", "flagged")),
        )
        .all()
    )
    stored: dict[date, set[str]] = {}
    for session_date, symbol in rows:
        stored.setdefault(_as_date(session_date), set()).add(symbol)
    return stored


def _dates_to_skip(stored: dict[date, set[str]]) -> set[date]:
    """Dates that already have stored Massive rows for the requested symbols.

    A live run commits a session only after that day's grouped write finishes,
    so any stored rows mean the session is done. A later day can hold more
    symbols when a ticker listed or was renamed. That does not make the older
    day incomplete. Days with no stored rows are fetched.
    """
    return {day for day, found in stored.items() if found}


def _skipped_day(day: date, symbols, stored_symbols: set[str], *, reason: str = "already_stored") -> dict:
    requested = list(dict.fromkeys(str(symbol).upper() for symbol in symbols))
    if reason == "market_closed":
        missing: list[str] = []
    else:
        missing = [symbol for symbol in requested if symbol not in stored_symbols]
    return {
        "day": day.isoformat(),
        "requested": len(symbols),
        "written_valid": 0,
        "written_flagged": 0,
        "rejected": [],
        "missing": missing,
        "skipped": True,
        "skip_reason": reason,
    }


def _as_date(value: object) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _coverage(symbols, per_day: list[dict]) -> dict:
    requested = [str(symbol).upper() for symbol in symbols]
    unique = list(dict.fromkeys(requested))
    gaps: dict[str, list[str]] = {symbol: [] for symbol in unique}
    for report in per_day:
        absent = set(report["missing"]) | set(report["rejected"])
        for symbol in unique:
            # Covered only when this session wrote a valid or flagged row.
            if symbol in absent:
                gaps[symbol].append(report["day"])
    return {
        "sessions_attempted": len(per_day),
        "sessions_with_data": sum(
            1 for report in per_day
            if report.get("skip_reason") not in _NO_DATA_SKIPS
            and (
                report.get("skipped")
                or report["written_valid"]
                or report["written_flagged"]
            )
        ),
        "sessions_skipped": sum(1 for report in per_day if report.get("skipped")),
        "sessions_not_yet_available": sum(
            1 for report in per_day if report.get("skip_reason") == "not_yet_available"
        ),
        "sessions_failed": sum(1 for report in per_day if "error" in report),
        "symbols_fully_covered": [symbol for symbol in unique if not gaps[symbol]],
        "symbols_with_gaps": {symbol: days for symbol, days in gaps.items() if days},
        "per_day": per_day,
    }


def _latest_prior_bars(db: Session, symbols: list[str], day: date) -> list[Bar]:
    if not symbols:
        return []
    latest_session = (
        db.query(
            MarketBarDaily.symbol.label("symbol"),
            func.max(MarketBarDaily.session_date).label("session_date"),
        )
        .filter(
            MarketBarDaily.symbol.in_(symbols),
            MarketBarDaily.session_date < day,
        )
        .group_by(MarketBarDaily.symbol)
        .subquery()
    )
    rows = (
        db.query(MarketBarDaily)
        .join(
            latest_session,
            and_(
                MarketBarDaily.symbol == latest_session.c.symbol,
                MarketBarDaily.session_date == latest_session.c.session_date,
            ),
        )
        .all()
    )
    chosen: dict[str, MarketBarDaily] = {}
    for row in rows:
        current = chosen.get(row.symbol)
        if current is None or _prior_sort_key(row) > _prior_sort_key(current):
            chosen[row.symbol] = row
    return [_bar_from_row(row) for row in chosen.values()]


def _prior_sort_key(row: MarketBarDaily) -> tuple:
    # Latest session wins. On that session, prefer the massive raw series.
    return (
        row.session_date,
        row.provider == _PROVIDER,
        row.adjustment_type == _ADJUSTMENT,
        row.quality_status == "valid",
    )


def _bar_from_row(row: MarketBarDaily) -> Bar:
    session_date = row.session_date
    if isinstance(session_date, datetime):
        session_date = session_date.date()
    fetched_at = row.fetched_at
    if not isinstance(fetched_at, datetime):
        fetched_at = datetime.now(timezone.utc)
    elif fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    return Bar(
        symbol=row.symbol,
        day=session_date,
        open=_as_decimal(row.open),
        high=_as_decimal(row.high),
        low=_as_decimal(row.low),
        close=_as_decimal(row.close),
        volume=int(row.volume),
        source=str(row.provider),
        fetched_at=fetched_at,
    )


def _as_decimal(value: object) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _fails_table_checks(bar: Bar) -> bool:
    for price in (bar.open, bar.high, bar.low, bar.close):
        if (not price.is_finite()) or price <= 0 or price >= _PRICE_CEILING:
            return True
    if not (bar.low <= bar.open <= bar.high and bar.low <= bar.close <= bar.high):
        return True
    return bar.volume < 0


def _upsert_daily_bar(db: Session, bar: Bar, quality_status: str) -> None:
    row = (
        db.query(MarketBarDaily)
        .filter(
            MarketBarDaily.symbol == bar.symbol,
            MarketBarDaily.session_date == bar.day,
            MarketBarDaily.provider == _PROVIDER,
            MarketBarDaily.adjustment_type == _ADJUSTMENT,
        )
        .first()
    )
    if row is None:
        row = MarketBarDaily(
            symbol=bar.symbol,
            session_date=bar.day,
            provider=_PROVIDER,
            adjustment_type=_ADJUSTMENT,
        )
        db.add(row)
    row.open = bar.open
    row.high = bar.high
    row.low = bar.low
    row.close = bar.close
    row.volume = bar.volume
    row.quality_status = quality_status
    # Timezone-aware on purpose. Do not copy Bar.fetched_at (naive) or the
    # naive clock used for MarketQuoteCache.
    row.fetched_at = datetime.now(timezone.utc)
