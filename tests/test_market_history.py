"""Cached data-status and two-year history. Fixtures only; no provider and no writes."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
from tempfile import TemporaryDirectory

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.ledger_entry import LedgerEntry
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.price_history_daily import PriceHistoryDaily
from app.models.user import User
from app.services import exchange_calendar
from app.services.market_history import (
    read_data_status,
    read_symbol_history,
    two_calendar_years_before,
)


@pytest.fixture(autouse=True)
def forbid_providers(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("provider called")

    monkeypatch.setattr("app.services.price_service.get_live_price", boom)
    monkeypatch.setattr("app.services.price_service.get_stock_quote", boom)
    monkeypatch.setattr("app.services.price_service.get_company_overview", boom)
    monkeypatch.setattr("app.services.price_service.get_top_gainers_losers", boom)
    monkeypatch.setattr("app.services.eod_service.fetch_eod_batch", boom)
    monkeypatch.setattr("app.services.sec_service.get_sec_company_fundamentals", boom)
    monkeypatch.setattr("requests.get", boom)


def _utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _symbol(db, symbol, *, etf=False, test=False, active=True, tier="daily", sector=None):
    db.add(MarketSymbol(
        symbol=symbol,
        company_name=symbol,
        exchange="NASDAQ",
        sector=sector,
        is_etf=etf,
        is_test=test,
        is_active=active,
        refresh_tier=tier,
    ))


def _quote(db, symbol, price, *, source="yahoo", quote_at, fetched_at=None):
    observed = quote_at
    db.add(MarketQuoteCache(
        symbol=symbol,
        price=price,
        change_amount=0,
        change_percent=0,
        volume=0,
        source=source,
        quote_at=observed,
        fetched_at=observed if fetched_at is None else fetched_at,
    ))


def _bar(
    db,
    symbol,
    session_date,
    *,
    provider="fixture",
    adjustment="raw",
    quality="valid",
    fetched_at,
    open_price=None,
    high_price=None,
    low_price=None,
    close_price=Decimal("11.000000"),
    volume=100,
):
    open_price = close_price if open_price is None else open_price
    low_price = close_price if low_price is None else low_price
    high_price = close_price if high_price is None else high_price
    db.add(MarketBarDaily(
        symbol=symbol,
        session_date=session_date,
        provider=provider,
        adjustment_type=adjustment,
        open=open_price,
        high=high_price,
        low=low_price,
        close=close_price,
        volume=volume,
        fetched_at=fetched_at,
        quality_status=quality,
    ))


def _legacy(db, symbol, session_date, close_price):
    db.add(PriceHistoryDaily(
        symbol=symbol,
        date=session_date,
        open=close_price,
        high=close_price,
        low=close_price,
        close=close_price,
        volume=1,
        source="yahoo",
    ))


def _history_params(**changes):
    params = {
        "interval": "1d",
        "range": "2y",
        "provider": "fixture",
        "adjustment_type": "raw",
    }
    params.update(changes)
    return params


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc)


def _assert_reconciled(body):
    quote = body["quote_census"]
    counts = quote["status_counts"]
    assert set(counts) == {"live-ish", "delayed", "cached", "stale"}
    assert quote["eligible_symbol_count"] == quote["cached_quote_rows"] + quote["missing_cache_rows"]
    assert quote["cached_quote_rows"] == quote["invalid_quote_rows"] + sum(counts.values())
    history = body["canonical_history"]
    assert history["row_count"] == sum(history["quality_counts"].values())
    assert history["row_count"] == sum(item["row_count"] for item in history["series"])
    for item in history["series"]:
        assert item["row_count"] == sum(item["quality_counts"].values())
        assert item["adjustment_type"] in {"raw", "split_adjusted"}
    assert body["coverage_status"] == "not_verified"
    assert body["expected_session_count"] is None
    assert body["collection"] == "disabled"
    blob = json.dumps(body).lower()
    for banned in ("cash_balance", "password", "alembic", "database_url", "api_key", "ledger", "holding"):
        assert banned not in blob


def _measure(engine, call):
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement:
            statements.append(" ".join(statement.split()))

    event.listen(engine, "before_cursor_execute", capture)
    try:
        return call(), statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def _pin_clock(monkeypatch, clock: datetime) -> None:
    monkeypatch.setattr("app.core.read_snapshot._python_utc_now", lambda: clock)


def _parameter_values(parameters):
    if parameters is None:
        return []
    if isinstance(parameters, dict):
        items = list(parameters.values())
    elif isinstance(parameters, (list, tuple)):
        items = list(parameters)
    else:
        items = [parameters]
    flat = []
    for item in items:
        if isinstance(item, (list, tuple)):
            flat.extend(item)
        else:
            flat.append(item)
    return flat


def _mentions_day(statement, parameters, day: date) -> bool:
    text = f"{statement} {parameters!r}"
    if day.isoformat() in text:
        return True
    if f"{day.year}, {day.month}, {day.day}" in text:
        return True
    for value in _parameter_values(parameters):
        if value == day:
            return True
        iso = getattr(value, "isoformat", None)
        if callable(iso) and str(iso())[:10] == day.isoformat():
            return True
    return False


class _CountingCursor:
    """Count rows SQLAlchemy fetches. sqlite3.Cursor fetch methods are read-only."""

    def __init__(self, cursor, sink):
        self._cursor = cursor
        self._sink = sink

    def __getattr__(self, name):
        return getattr(self._cursor, name)

    def fetchall(self):
        rows = self._cursor.fetchall()
        self._sink.append(len(rows))
        return rows

    def fetchmany(self, *args):
        rows = self._cursor.fetchmany(*args)
        self._sink.append(len(rows))
        return rows

    def fetchone(self):
        row = self._cursor.fetchone()
        self._sink.append(0 if row is None else 1)
        return row


def _watch_bar_reads(engine):
    fetches = []
    statements = []

    def before(_conn, cursor, statement, parameters, context, _executemany):
        if not statement or "market_bars_daily" not in statement.lower():
            return
        statements.append((" ".join(statement.split()), parameters))
        # Swap the context cursor before the result reads it. Execute still
        # uses the native cursor already passed into this event.
        context.cursor = _CountingCursor(cursor, fetches)

    event.listen(engine, "before_cursor_execute", before)
    return fetches, statements, before


def _assert_bounded_bar_read(statements, fetches, start: date, end: date, in_window: int) -> None:
    assert statements, "history read did not query canonical bars"
    for statement, parameters in statements:
        assert _mentions_day(statement, parameters, start), statement
        assert _mentions_day(statement, parameters, end), statement
    assert fetches, "history read did not fetch canonical rows"
    assert sum(fetches) == in_window
    assert max(fetches) <= in_window


def test_legacy_only_symbol_is_unavailable_without_fallback(client, db_session):
    fetched = _aware(_utc_now() - timedelta(hours=2))
    _symbol(db_session, "NVDA")
    _quote(db_session, "NVDA", Decimal("77.250000"), quote_at=_utc_now() - timedelta(hours=2))
    _legacy(db_session, "NVDA", date(2026, 11, 4), Decimal("99.125000"))
    _bar(db_session, "NVDA", date(2026, 10, 1), provider="other", close_price=Decimal("55.000000"), fetched_at=fetched)
    db_session.commit()

    response = client.get("/market/symbols/NVDA/history", params=_history_params())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unavailable"
    assert body["bars"] == []
    assert body["available_start"] is None
    assert body["available_end"] is None
    assert body["excluded_row_count"] == 0
    assert "outside_range_count" not in body
    # No canonical bars were returned for this symbol/provider, so every expected NYSE
    # trading day in the requested window is missing: the calendar reports "gaps".
    requested_start = date.fromisoformat(body["requested_start"])
    requested_end = date.fromisoformat(body["requested_end"])
    assert body["coverage_status"] == "gaps"
    assert body["expected_session_count"] == exchange_calendar.expected_session_count(
        requested_start, requested_end
    )
    serialized = json.dumps(body)
    assert "99.125" not in serialized
    assert "77.25" not in serialized
    assert "55.000" not in serialized


def test_provider_and_adjustment_series_stay_separate(client, db_session):
    session_date = _utc_now().date() - timedelta(days=20)
    fetched = _aware(_utc_now() - timedelta(hours=3))
    _symbol(db_session, "NVDA")
    _bar(
        db_session, "NVDA", session_date, provider="fixture", adjustment="raw",
        close_price=Decimal("10.000000"), fetched_at=fetched,
    )
    _bar(
        db_session, "NVDA", session_date, provider="fixture", adjustment="split_adjusted",
        close_price=Decimal("40.000000"), fetched_at=fetched,
    )
    _bar(
        db_session, "NVDA", session_date, provider="other", adjustment="raw",
        close_price=Decimal("70.000000"), fetched_at=fetched,
    )
    db_session.commit()

    raw = client.get("/market/symbols/NVDA/history", params=_history_params()).json()
    adjusted = client.get(
        "/market/symbols/NVDA/history",
        params=_history_params(adjustment_type="split_adjusted"),
    ).json()
    other = client.get(
        "/market/symbols/NVDA/history",
        params=_history_params(provider="other"),
    ).json()

    assert [bar["close"] for bar in raw["bars"]] == ["10.000000"]
    assert [bar["close"] for bar in adjusted["bars"]] == ["40.000000"]
    assert [bar["close"] for bar in other["bars"]] == ["70.000000"]
    assert {bar["provider"] for bar in raw["bars"]} == {"fixture"}
    assert {bar["adjustment_type"] for bar in adjusted["bars"]} == {"split_adjusted"}
    assert raw["excluded_row_count"] == 0
    assert adjusted["excluded_row_count"] == 0


def test_bars_are_chronological_with_exact_decimal_strings(client, db_session):
    today = _utc_now().date()
    fetched = _aware(_utc_now() - timedelta(hours=4))
    older = today - timedelta(days=30)
    newer = today - timedelta(days=10)
    gap = today - timedelta(days=29)
    _symbol(db_session, "NVDA")
    _bar(
        db_session, "NVDA", newer, fetched_at=fetched, volume=0,
        open_price=Decimal("1.500000"), high_price=Decimal("2.000000"),
        low_price=Decimal("1.250000"), close_price=Decimal("1.750000"),
    )
    _bar(
        db_session, "NVDA", older, fetched_at=fetched, volume=0,
        open_price=Decimal("10.250000"), high_price=Decimal("11.000000"),
        low_price=Decimal("10.000000"), close_price=Decimal("10.500000"),
    )
    db_session.commit()

    body = client.get("/market/symbols/NVDA/history", params=_history_params()).json()
    assert body["status"] == "partial"
    assert body["status"] != "complete"
    dates = [bar["session_date"] for bar in body["bars"]]
    assert dates == [older.isoformat(), newer.isoformat()]
    assert gap.isoformat() not in dates
    assert len(dates) == len(set(dates))
    first, second = body["bars"]
    assert first["open"] == "10.250000"
    assert first["high"] == "11.000000"
    assert first["low"] == "10.000000"
    assert first["close"] == "10.500000"
    assert first["volume"] == "0"
    assert second["volume"] == "0"
    assert all(isinstance(bar["open"], str) and isinstance(bar["volume"], str) for bar in body["bars"])
    assert first["fetched_at"].endswith("Z")
    assert body["available_start"] == older.isoformat()
    assert body["available_end"] == newer.isoformat()
    assert body["requested_start"] == two_calendar_years_before(date.fromisoformat(body["requested_end"])).isoformat()
    assert body["provider"] == "fixture"
    assert body["adjustment_type"] == "raw"
    assert body["interval"] == "1d"
    assert body["range"] == "2y"


def test_flagged_rejected_and_future_rows_are_excluded(client, db_session):
    _symbol(db_session, "NVDA")
    db_session.commit()
    probe = client.get("/market/symbols/NVDA/history", params=_history_params()).json()
    now = datetime.fromisoformat(probe["read_at"].replace("Z", "+00:00")).replace(tzinfo=None)
    today = date.fromisoformat(probe["requested_end"])
    fetched = _aware(now - timedelta(hours=2))
    future_fetch = _aware(now + timedelta(days=2))
    _bar(db_session, "NVDA", today - timedelta(days=15), fetched_at=fetched, close_price=Decimal("11.000000"))
    _bar(db_session, "NVDA", today - timedelta(days=14), quality="flagged", fetched_at=fetched)
    _bar(db_session, "NVDA", today - timedelta(days=13), quality="rejected", fetched_at=fetched)
    _bar(db_session, "NVDA", today + timedelta(days=3), fetched_at=fetched)
    _bar(db_session, "NVDA", today - timedelta(days=12), fetched_at=future_fetch)
    _bar(db_session, "NVDA", today - timedelta(days=800), fetched_at=fetched, close_price=Decimal("8.000000"))
    _bar(
        db_session, "NVDA", today - timedelta(days=15), adjustment="split_adjusted",
        fetched_at=fetched, close_price=Decimal("33.000000"),
    )
    db_session.commit()

    body = client.get("/market/symbols/NVDA/history", params=_history_params()).json()
    assert [bar["session_date"] for bar in body["bars"]] == [(today - timedelta(days=15)).isoformat()]
    assert [bar["close"] for bar in body["bars"]] == ["11.000000"]
    assert body["excluded_row_count"] == 3
    assert "outside_range_count" not in body
    returned_dates = {bar["session_date"] for bar in body["bars"]}
    assert (today - timedelta(days=800)).isoformat() not in returned_dates
    assert (today + timedelta(days=3)).isoformat() not in returned_dates
    assert "8.000000" not in json.dumps(body["bars"])
    assert all(bar["quality_status"] == "valid" for bar in body["bars"])

    adjusted = client.get(
        "/market/symbols/NVDA/history",
        params=_history_params(adjustment_type="split_adjusted"),
    ).json()
    assert [bar["close"] for bar in adjusted["bars"]] == ["33.000000"]
    assert adjusted["excluded_row_count"] == 0


def test_query_validation_and_unknown_symbol(client, db_session):
    _symbol(db_session, "NVDA")
    db_session.commit()
    cases = [
        {"interval": "1h", "range": "2y", "provider": "fixture", "adjustment_type": "raw"},
        {"interval": "1D", "range": "2y", "provider": "fixture", "adjustment_type": "raw"},
        {"interval": "1d", "range": "5y", "provider": "fixture", "adjustment_type": "raw"},
        {"interval": "1d", "range": "1y", "provider": "fixture", "adjustment_type": "raw"},
        {"interval": "1d", "range": "2Y", "provider": "fixture", "adjustment_type": "raw"},
        {"interval": "1d", "range": "2y", "provider": "fixture", "adjustment_type": "adjusted"},
        {"interval": "1d", "range": "2y", "provider": " fixture", "adjustment_type": "raw"},
        {"interval": "1d", "range": "2y", "provider": "fixture ", "adjustment_type": "raw"},
        {"interval": "1d", "range": "2y", "provider": "", "adjustment_type": "raw"},
        {"interval": "1d", "range": "2y", "provider": "p" * 33, "adjustment_type": "raw"},
        {"interval": "1d", "range": "2y", "adjustment_type": "raw"},
        {"interval": "1d", "provider": "fixture", "adjustment_type": "raw"},
    ]
    for params in cases:
        response = client.get("/market/symbols/NVDA/history", params=params)
        assert response.status_code == 422, params

    missing = client.get("/market/symbols/NO_SUCH/history", params=_history_params())
    assert missing.status_code == 404
    long_symbol = client.get(f"/market/symbols/{'N' * 21}/history", params=_history_params())
    assert long_symbol.status_code == 422
    with pytest.raises(HTTPException) as caught:
        read_symbol_history(
            db_session,
            symbol=" NVDA",
            interval="1d",
            range_token="2y",
            provider="fixture",
            adjustment_type="raw",
        )
    assert caught.value.status_code == 422

    known_empty = client.get("/market/symbols/NVDA/history", params=_history_params())
    assert known_empty.status_code == 200
    assert known_empty.json()["status"] == "unavailable"
    assert known_empty.json()["bars"] == []


def test_leap_day_bounds_and_requested_window(client, db_session, monkeypatch):
    assert two_calendar_years_before(date(2024, 2, 29)) == date(2022, 2, 28)
    assert two_calendar_years_before(date(2028, 2, 29)) == date(2026, 2, 28)
    assert two_calendar_years_before(date(2026, 11, 5)) == date(2024, 11, 5)
    assert two_calendar_years_before(date(2024, 3, 1)) == date(2022, 3, 1)

    clock = datetime(2024, 2, 29, 15, 0)
    _pin_clock(monkeypatch, clock)
    start = date(2022, 2, 28)
    end = date(2024, 2, 29)
    fetched = _aware(datetime(2024, 2, 29, 14, 0))
    _symbol(db_session, "NVDA")
    _bar(db_session, "NVDA", start, fetched_at=fetched, close_price=Decimal("5.000000"))
    _bar(db_session, "NVDA", end, fetched_at=fetched, close_price=Decimal("6.000000"))
    _bar(db_session, "NVDA", date(2022, 2, 27), fetched_at=fetched, close_price=Decimal("4.000000"))
    _bar(db_session, "NVDA", date(2024, 3, 1), fetched_at=fetched, close_price=Decimal("7.000000"))
    _bar(
        db_session, "NVDA", date(2023, 6, 1), quality="flagged",
        fetched_at=fetched, close_price=Decimal("8.000000"),
    )
    db_session.commit()

    engine = db_session.get_bind()
    fetches, statements, hook = _watch_bar_reads(engine)
    try:
        response = client.get("/market/symbols/NVDA/history", params=_history_params())
    finally:
        event.remove(engine, "before_cursor_execute", hook)

    assert response.status_code == 200
    body = response.json()
    _assert_bounded_bar_read(statements, fetches, start, end, in_window=3)
    assert body["read_at"] == "2024-02-29T15:00:00Z"
    assert body["requested_start"] == "2022-02-28"
    assert body["requested_end"] == "2024-02-29"
    assert [bar["session_date"] for bar in body["bars"]] == ["2022-02-28", "2024-02-29"]
    assert [bar["close"] for bar in body["bars"]] == ["5.000000", "6.000000"]
    assert body["excluded_row_count"] == 1
    assert "outside_range_count" not in body
    assert "4.000000" not in json.dumps(body["bars"])
    assert "7.000000" not in json.dumps(body["bars"])
    # Only 2 of the many expected NYSE trading days in this ~2-year window were returned
    # (both are themselves real trading days, so none are "unexpected"): the calendar
    # reports "gaps".
    assert body["coverage_status"] == "gaps"
    assert body["expected_session_count"] == exchange_calendar.expected_session_count(start, end)
    assert body["status"] == "partial"


def test_coverage_status_complete_when_every_expected_session_is_present(client, db_session, monkeypatch):
    end = date(2026, 6, 15)
    _pin_clock(monkeypatch, datetime(2026, 6, 15, 16, 0))
    start = two_calendar_years_before(end)
    _symbol(db_session, "FULL")
    fetched = _aware(datetime(2026, 6, 15, 10, 0))
    expected = exchange_calendar.expected_session_dates(start, end)
    for day in expected:
        _bar(db_session, "FULL", day, fetched_at=fetched, close_price=Decimal("1.000000"))
    db_session.commit()

    response = client.get("/market/symbols/FULL/history", params=_history_params())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "partial"
    assert body["coverage_status"] == "complete"
    assert body["expected_session_count"] == len(expected)
    assert len(body["bars"]) == len(expected)


def test_coverage_status_unexpected_sessions_when_bar_on_non_trading_day(client, db_session, monkeypatch):
    end = date(2026, 6, 15)
    _pin_clock(monkeypatch, datetime(2026, 6, 15, 16, 0))
    start = two_calendar_years_before(end)
    _symbol(db_session, "STRAY")
    fetched = _aware(datetime(2026, 6, 15, 10, 0))
    expected = exchange_calendar.expected_session_dates(start, end)
    for day in expected:
        _bar(db_session, "STRAY", day, fetched_at=fetched, close_price=Decimal("1.000000"))
    # 2026-06-13 is a Saturday within [start, end]: confirmed non-trading, and not in `expected`.
    non_trading_day = date(2026, 6, 13)
    assert exchange_calendar.is_nyse_trading_day(non_trading_day) is False
    assert non_trading_day not in expected
    _bar(db_session, "STRAY", non_trading_day, fetched_at=fetched, close_price=Decimal("1.000000"))
    db_session.commit()

    response = client.get("/market/symbols/STRAY/history", params=_history_params())
    assert response.status_code == 200
    body = response.json()
    assert body["coverage_status"] == "unexpected_sessions"
    assert body["expected_session_count"] == len(expected)
    assert len(body["bars"]) == len(expected) + 1


def test_coverage_status_gaps_and_unexpected_sessions_combined(client, db_session, monkeypatch):
    end = date(2026, 6, 15)
    _pin_clock(monkeypatch, datetime(2026, 6, 15, 16, 0))
    start = two_calendar_years_before(end)
    _symbol(db_session, "MIXED")
    fetched = _aware(datetime(2026, 6, 15, 10, 0))
    expected = exchange_calendar.expected_session_dates(start, end)
    # Omit the very first expected day (a gap), and add a bar on a confirmed non-trading
    # Saturday (an unexpected session).
    missing_day = expected[0]
    for day in expected[1:]:
        _bar(db_session, "MIXED", day, fetched_at=fetched, close_price=Decimal("1.000000"))
    non_trading_day = date(2026, 6, 13)
    assert exchange_calendar.is_nyse_trading_day(non_trading_day) is False
    _bar(db_session, "MIXED", non_trading_day, fetched_at=fetched, close_price=Decimal("1.000000"))
    db_session.commit()

    response = client.get("/market/symbols/MIXED/history", params=_history_params())
    assert response.status_code == 200
    body = response.json()
    assert body["coverage_status"] == "gaps_and_unexpected_sessions"
    assert body["expected_session_count"] == len(expected)
    returned_dates = {bar["session_date"] for bar in body["bars"]}
    assert missing_day.isoformat() not in returned_dates
    assert non_trading_day.isoformat() in returned_dates


def test_coverage_status_falls_back_to_not_verified_outside_calendar_range(client, db_session, monkeypatch):
    # The calendar supports 1990-2035. Pin the clock past that range so the requested
    # window itself falls outside it, forcing the documented ValueError fallback.
    clock = datetime(2036, 6, 15, 16, 0)
    _pin_clock(monkeypatch, clock)
    _symbol(db_session, "FUTURE")
    db_session.commit()
    with pytest.raises(ValueError):
        exchange_calendar.expected_session_dates(two_calendar_years_before(clock.date()), clock.date())

    response = client.get("/market/symbols/FUTURE/history", params=_history_params())
    assert response.status_code == 200
    body = response.json()
    assert body["coverage_status"] == "not_verified"
    assert body["expected_session_count"] is None


def test_history_query_fetches_only_the_requested_window(client, db_session, monkeypatch):
    clock = datetime(2026, 11, 5, 18, 27, 2, 258005)
    _pin_clock(monkeypatch, clock)
    start = date(2024, 11, 5)
    end = date(2026, 11, 5)
    fetched = _aware(clock - timedelta(hours=1))
    _symbol(db_session, "NVDA")
    outside = 0
    day = date(2006, 11, 5)
    while day < start:
        _bar(db_session, "NVDA", day, fetched_at=fetched, close_price=Decimal("9.000000"))
        outside += 1
        day += timedelta(days=7)
    assert outside > 900
    _bar(db_session, "NVDA", end + timedelta(days=1), fetched_at=fetched, close_price=Decimal("9.000000"))
    _bar(db_session, "NVDA", start, fetched_at=fetched, close_price=Decimal("5.000000"))
    _bar(db_session, "NVDA", date(2026, 11, 4), fetched_at=fetched, close_price=Decimal("6.000000"))
    _bar(
        db_session, "NVDA", date(2025, 6, 2), quality="flagged",
        fetched_at=fetched, close_price=Decimal("7.000000"),
    )
    _bar(
        db_session, "NVDA", date(2025, 7, 1),
        fetched_at=_aware(clock + timedelta(microseconds=1)),
        close_price=Decimal("8.000000"),
    )
    db_session.commit()

    engine = db_session.get_bind()
    fetches, statements, hook = _watch_bar_reads(engine)
    try:
        response = client.get("/market/symbols/NVDA/history", params=_history_params())
    finally:
        event.remove(engine, "before_cursor_execute", hook)

    assert response.status_code == 200
    body = response.json()
    _assert_bounded_bar_read(statements, fetches, start, end, in_window=4)
    assert len(statements) == 1
    assert [bar["session_date"] for bar in body["bars"]] == ["2024-11-05", "2026-11-04"]
    assert [bar["close"] for bar in body["bars"]] == ["5.000000", "6.000000"]
    assert body["excluded_row_count"] == 2
    assert body["available_start"] == "2024-11-05"
    assert body["available_end"] == "2026-11-04"
    assert body["requested_start"] == "2024-11-05"
    assert body["requested_end"] == "2026-11-05"
    assert "outside_range_count" not in body
    assert "9.000000" not in json.dumps(body["bars"])


def test_same_second_history_fetch_keeps_an_earlier_fraction(client, db_session, monkeypatch):
    clock = datetime(2026, 11, 5, 18, 27, 2, 258005)
    _pin_clock(monkeypatch, clock)
    earlier = datetime(2026, 11, 5, 18, 27, 2, 129002)
    later_fraction = datetime(2026, 11, 5, 18, 27, 2, 258006)
    truly_future = clock + timedelta(hours=1)
    _symbol(db_session, "NVDA")
    _bar(db_session, "NVDA", date(2026, 11, 2), fetched_at=_aware(clock), close_price=Decimal("3.000000"))
    _bar(db_session, "NVDA", date(2026, 11, 3), fetched_at=_aware(later_fraction), close_price=Decimal("8.000000"))
    _bar(db_session, "NVDA", date(2026, 11, 4), fetched_at=_aware(earlier), close_price=Decimal("5.000000"))
    _bar(db_session, "NVDA", date(2026, 11, 1), fetched_at=_aware(truly_future), close_price=Decimal("9.000000"))
    db_session.commit()

    body = client.get("/market/symbols/NVDA/history", params=_history_params()).json()
    assert body["read_at"] == "2026-11-05T18:27:02.258005Z"
    assert [bar["session_date"] for bar in body["bars"]] == ["2026-11-02", "2026-11-04"]
    assert body["bars"][1]["fetched_at"] == "2026-11-05T18:27:02.129002Z"
    assert body["bars"][0]["fetched_at"] == "2026-11-05T18:27:02.258005Z"
    assert body["excluded_row_count"] == 2
    assert "8.000000" not in json.dumps(body["bars"])
    assert "9.000000" not in json.dumps(body["bars"])
    assert "outside_range_count" not in body


def test_same_second_quote_is_fresh_and_a_later_fraction_is_invalid(client, db_session, monkeypatch):
    clock = datetime(2026, 11, 5, 18, 27, 2, 258005)
    _pin_clock(monkeypatch, clock)
    observed = datetime(2026, 11, 5, 17, 27, 2, 129002)
    earlier = datetime(2026, 11, 5, 18, 27, 2, 129002)
    later_fraction = datetime(2026, 11, 5, 18, 27, 2, 258006)
    truly_future = datetime(2026, 11, 5, 19, 27, 2, 258005)
    for symbol in ("KEPT", "FETF", "QFUT", "FARF", "EQUL"):
        _symbol(db_session, symbol)
    _quote(db_session, "KEPT", Decimal("10"), quote_at=observed, fetched_at=earlier)
    _quote(db_session, "FETF", Decimal("11"), quote_at=observed, fetched_at=later_fraction)
    _quote(db_session, "QFUT", Decimal("12"), quote_at=later_fraction, fetched_at=earlier)
    _quote(db_session, "FARF", Decimal("13"), quote_at=truly_future, fetched_at=earlier)
    _quote(db_session, "EQUL", Decimal("14"), quote_at=observed, fetched_at=clock)
    db_session.commit()

    response = client.get("/market/data-status")
    assert response.status_code == 200
    body = response.json()
    _assert_reconciled(body)
    assert body["read_at"] == "2026-11-05T18:27:02.258005Z"
    assert body["read_at"] != "2026-11-05T18:27:02Z"
    quote = body["quote_census"]
    assert quote["eligible_symbol_count"] == 5
    assert quote["cached_quote_rows"] == 5
    assert quote["missing_cache_rows"] == 0
    assert quote["invalid_quote_rows"] == 3
    assert quote["status_counts"] == {"live-ish": 0, "delayed": 2, "cached": 0, "stale": 0}


def test_reads_do_not_call_providers_or_write(client, db_session):
    fetched = _aware(_utc_now() - timedelta(days=1))
    _symbol(db_session, "NVDA")
    _bar(db_session, "NVDA", _utc_now().date() - timedelta(days=40), fetched_at=fetched)
    db_session.commit()

    def counts():
        return (
            db_session.scalar(select(func.count()).select_from(MarketBarDaily)),
            db_session.scalar(select(func.count()).select_from(MarketQuoteCache)),
            db_session.scalar(select(func.count()).select_from(PriceHistoryDaily)),
            db_session.scalar(select(func.count()).select_from(MarketSymbol)),
            db_session.scalar(select(func.count()).select_from(User)),
            db_session.scalar(select(func.count()).select_from(LedgerEntry)),
        )

    before = counts()
    engine = db_session.get_bind()

    def read_both():
        status = client.get("/market/data-status")
        history = client.get("/market/symbols/NVDA/history", params=_history_params())
        return status, history

    (status, history), statements = _measure(engine, read_both)
    assert status.status_code == 200
    assert history.status_code == 200
    assert history.json()["bars"]
    assert counts() == before
    for statement in statements:
        word = statement.lstrip().split(None, 1)[0].lower()
        assert word not in {"insert", "update", "delete"}

    db_session.add(MarketSymbol(symbol="AFTER", company_name="After", exchange="NASDAQ"))
    db_session.commit()
    assert db_session.scalar(select(func.count()).select_from(MarketSymbol)) == before[3] + 1


def test_data_status_denominators_reconcile_and_invalid_quotes_are_not_fresh(client, db_session):
    probe = client.get("/market/data-status")
    assert probe.status_code == 200
    now = datetime.fromisoformat(probe.json()["read_at"].replace("Z", "+00:00")).replace(tzinfo=None)
    recent = now - timedelta(hours=2)
    live = now - timedelta(minutes=5)
    cached_at = now - timedelta(days=4)
    stale_at = now - timedelta(days=9)
    future = now + timedelta(days=2)
    _symbol(db_session, "AAPL", tier="hot")
    _symbol(db_session, "MSFT")
    _symbol(db_session, "HOT1", tier="hot")
    _symbol(db_session, "CACH")
    _symbol(db_session, "STALE")
    _symbol(db_session, "ZERO")
    _symbol(db_session, "FUTR")
    _symbol(db_session, "OTHR", sector="Other")
    _symbol(db_session, "SPY", etf=True)
    _symbol(db_session, "TSYM", test=True)
    _symbol(db_session, "DEAD", active=False)
    _quote(db_session, "AAPL", Decimal("10"), quote_at=recent)
    _quote(db_session, "HOT1", Decimal("5"), source="manual", quote_at=live)
    _quote(db_session, "CACH", Decimal("8"), quote_at=cached_at)
    _quote(db_session, "STALE", Decimal("9"), source="alpha_vantage", quote_at=stale_at)
    _quote(db_session, "ZERO", Decimal("0"), quote_at=recent)
    _quote(db_session, "FUTR", Decimal("12"), quote_at=future)
    _quote(db_session, "OTHR", Decimal("7"), quote_at=recent)
    _quote(db_session, "SPY", Decimal("400"), quote_at=recent)
    _quote(db_session, "TSYM", Decimal("3"), quote_at=recent)
    _quote(db_session, "DEAD", Decimal("6"), quote_at=recent)

    bar_fetch = _aware(now - timedelta(days=1))
    _bar(db_session, "AAPL", date(2024, 6, 3), provider="fixture", adjustment="raw", quality="valid", fetched_at=bar_fetch)
    _bar(db_session, "AAPL", date(2024, 3, 1), provider="fixture", adjustment="split_adjusted", quality="flagged", fetched_at=bar_fetch)
    _bar(db_session, "AAPL", date(2025, 1, 2), provider="other", adjustment="raw", quality="rejected", fetched_at=bar_fetch)
    _bar(db_session, "TSYM", date(2024, 1, 2), provider="fixture", adjustment="raw", quality="valid", fetched_at=bar_fetch)
    _legacy(db_session, "AAPL", date(2024, 6, 3), Decimal("10"))
    _legacy(db_session, "SPY", date(2024, 6, 3), Decimal("400"))
    db_session.commit()

    response = client.get("/market/data-status")
    assert response.status_code == 200
    body = response.json()
    _assert_reconciled(body)
    assert body["universe"]["active_non_test_symbols"] == 9
    quote = body["quote_census"]
    assert quote["population"] == "active_non_test_non_etf"
    assert quote["sector_filter_applied"] is False
    assert quote["eligible_symbol_count"] == 8
    assert quote["cached_quote_rows"] == 7
    assert quote["missing_cache_rows"] == 1
    assert quote["invalid_quote_rows"] == 2
    assert quote["status_counts"] == {"live-ish": 1, "delayed": 2, "cached": 1, "stale": 1}

    history = body["canonical_history"]
    assert history["row_count"] == 4
    assert history["quality_counts"] == {"valid": 2, "flagged": 1, "rejected": 1}
    series = {(item["provider"], item["adjustment_type"]): item for item in history["series"]}
    assert set(series) == {("fixture", "raw"), ("fixture", "split_adjusted"), ("other", "raw")}
    assert series[("fixture", "raw")]["row_count"] == 2
    assert series[("fixture", "raw")]["symbol_count"] == 2
    assert series[("fixture", "raw")]["quality_counts"]["valid"] == 2
    assert series[("fixture", "raw")]["stored_session_start"] == "2024-01-02"
    assert series[("fixture", "raw")]["stored_session_end"] == "2024-06-03"
    assert series[("fixture", "split_adjusted")]["quality_counts"]["flagged"] == 1
    assert series[("other", "raw")]["quality_counts"]["rejected"] == 1
    assert body["legacy_price_history_daily"]["row_count"] == 2
    assert history["row_count"] == 4


def _status_week():
    """Monday 2024-06-03 through Friday 2024-06-07. No NYSE holiday falls in this week."""
    start = date(2024, 6, 3)
    end = date(2024, 6, 7)
    expected = exchange_calendar.expected_session_dates(start, end)
    assert expected == [
        date(2024, 6, 3),
        date(2024, 6, 4),
        date(2024, 6, 5),
        date(2024, 6, 6),
        date(2024, 6, 7),
    ]
    return start, end, expected


def _seed_status_bars(db, symbol, days, *, provider, adjustment="raw", quality="valid"):
    fetched = _aware(_utc_now() - timedelta(hours=2))
    for day in days:
        _bar(
            db, symbol, day,
            provider=provider, adjustment=adjustment, quality=quality, fetched_at=fetched,
        )


def _assert_top_level_coverage_unchanged(body):
    assert body["coverage_status"] == "not_verified"
    assert body["expected_session_count"] is None


def _data_status_series(client):
    response = client.get("/market/data-status")
    assert response.status_code == 200
    body = response.json()
    series = {
        (item["provider"], item["adjustment_type"]): item
        for item in body["canonical_history"]["series"]
    }
    return body, series


def test_data_status_series_coverage_complete(client, db_session):
    _start, _end, expected = _status_week()
    _symbol(db_session, "AAPL")
    # Friday is flagged on purpose. Series coverage counts every stored session, not only "valid".
    _seed_status_bars(db_session, "AAPL", expected[:-1], provider="fixture", adjustment="raw")
    _seed_status_bars(db_session, "AAPL", expected[-1:], provider="fixture", adjustment="raw", quality="flagged")
    db_session.commit()

    body, series = _data_status_series(client)
    item = series[("fixture", "raw")]
    assert item["coverage_status"] == "complete"
    assert item["expected_session_count"] == len(expected)
    assert item["stored_session_start"] == expected[0].isoformat()
    assert item["stored_session_end"] == expected[-1].isoformat()
    assert item["quality_counts"]["flagged"] == 1
    _assert_top_level_coverage_unchanged(body)


def test_data_status_series_coverage_gaps(client, db_session):
    _start, _end, expected = _status_week()
    missing = expected[2]
    _symbol(db_session, "AAPL")
    _seed_status_bars(
        db_session, "AAPL", [day for day in expected if day != missing],
        provider="fixture", adjustment="raw",
    )
    db_session.commit()

    body, series = _data_status_series(client)
    item = series[("fixture", "raw")]
    assert item["coverage_status"] == "gaps"
    assert item["expected_session_count"] == len(expected)
    assert item["stored_session_start"] == expected[0].isoformat()
    assert item["stored_session_end"] == expected[-1].isoformat()
    _assert_top_level_coverage_unchanged(body)


def test_data_status_series_coverage_unexpected_sessions(client, db_session):
    _start, _end, expected = _status_week()
    saturday = date(2024, 6, 8)
    assert saturday.weekday() == 5
    assert exchange_calendar.is_nyse_trading_day(saturday) is False
    assert saturday not in expected
    _symbol(db_session, "AAPL")
    _seed_status_bars(db_session, "AAPL", expected, provider="fixture", adjustment="raw")
    # Rejected on purpose: a non-trading day still counts, at any quality_status.
    _seed_status_bars(db_session, "AAPL", [saturday], provider="fixture", adjustment="raw", quality="rejected")
    db_session.commit()

    body, series = _data_status_series(client)
    item = series[("fixture", "raw")]
    assert item["coverage_status"] == "unexpected_sessions"
    assert item["expected_session_count"] == len(exchange_calendar.expected_session_dates(expected[0], saturday))
    assert item["stored_session_end"] == saturday.isoformat()
    _assert_top_level_coverage_unchanged(body)


def test_data_status_series_coverage_gaps_and_unexpected_sessions(client, db_session):
    _start, _end, expected = _status_week()
    missing = expected[2]
    saturday = date(2024, 6, 8)
    assert exchange_calendar.is_nyse_trading_day(saturday) is False
    _symbol(db_session, "AAPL")
    _seed_status_bars(
        db_session, "AAPL", [day for day in expected if day != missing],
        provider="fixture", adjustment="raw",
    )
    _seed_status_bars(db_session, "AAPL", [saturday], provider="fixture", adjustment="raw")
    db_session.commit()

    body, series = _data_status_series(client)
    item = series[("fixture", "raw")]
    assert item["coverage_status"] == "gaps_and_unexpected_sessions"
    assert item["expected_session_count"] == len(exchange_calendar.expected_session_dates(expected[0], saturday))
    _assert_top_level_coverage_unchanged(body)


def test_data_status_series_coverage_stays_independent_across_series(client, db_session):
    _start, _end, expected = _status_week()
    missing = expected[2]
    _symbol(db_session, "AAPL")
    _seed_status_bars(db_session, "AAPL", expected, provider="fixture", adjustment="raw")
    _seed_status_bars(
        db_session, "AAPL", [day for day in expected if day != missing],
        provider="other", adjustment="raw",
    )
    db_session.commit()

    body, series = _data_status_series(client)
    complete = series[("fixture", "raw")]
    gaps = series[("other", "raw")]
    assert complete["coverage_status"] == "complete"
    assert complete["expected_session_count"] == len(expected)
    assert gaps["coverage_status"] == "gaps"
    assert gaps["expected_session_count"] == len(expected)
    assert complete["coverage_status"] != gaps["coverage_status"]
    _assert_top_level_coverage_unchanged(body)


def test_data_status_query_count_does_not_grow_with_symbols(client, db_session):
    engine = db_session.get_bind()
    assert client.get("/market/data-status").status_code == 200
    _, small_sql = _measure(engine, lambda: client.get("/market/data-status"))
    for index in range(45):
        _symbol(db_session, f"S{index:02d}")
    db_session.commit()
    filled, large_sql = _measure(engine, lambda: client.get("/market/data-status"))
    assert filled.status_code == 200
    assert filled.json()["universe"]["active_non_test_symbols"] == 45
    assert len(small_sql) == len(large_sql)
    assert len(large_sql) < 20
    symbol_sql = [statement for statement in large_sql if "market_symbols" in statement.lower()]
    assert symbol_sql
    assert len(symbol_sql) < 5


def _status_image(body):
    quote = body["quote_census"]
    return (
        body["universe"]["active_non_test_symbols"],
        quote["eligible_symbol_count"],
        quote["cached_quote_rows"],
        quote["missing_cache_rows"],
        quote["invalid_quote_rows"],
        body["canonical_history"]["row_count"],
        body["legacy_price_history_daily"]["row_count"],
    )


def test_concurrent_change_keeps_status_counts_consistent():
    before = (3, 2, 1, 1, 0, 0, 0)
    after = (4, 3, 3, 0, 0, 1, 1)
    with TemporaryDirectory() as folder:
        engine = create_engine(
            f"sqlite:///{folder}/status.db",
            connect_args={"check_same_thread": False, "timeout": 5},
            future=True,
        )

        @event.listens_for(engine, "connect")
        def _wal(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

        Base.metadata.create_all(bind=engine)
        sessions = sessionmaker(bind=engine, autoflush=False, future=True)
        seed = sessions()
        now = _utc_now()
        _symbol(seed, "AAPL")
        _symbol(seed, "MSFT")
        _symbol(seed, "SPY", etf=True)
        _quote(seed, "AAPL", Decimal("10"), quote_at=now - timedelta(hours=1))
        seed.commit()
        seed.close()

        writer = sessions()
        state = {"fired": False}

        def apply_update():
            _symbol(writer, "NVDA")
            _quote(writer, "NVDA", Decimal("20"), quote_at=now - timedelta(hours=1))
            _quote(writer, "MSFT", Decimal("30"), quote_at=now - timedelta(hours=1))
            _bar(
                writer, "AAPL", now.date() - timedelta(days=10),
                fetched_at=_aware(now - timedelta(hours=1)),
            )
            _legacy(writer, "AAPL", now.date() - timedelta(days=10), Decimal("10"))
            writer.commit()

        def after_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
            if state["fired"] or not statement or "market_read_at" not in statement.lower():
                return
            state["fired"] = True
            apply_update()

        event.listen(engine, "after_cursor_execute", after_execute)
        try:
            reader = sessions()
            inflight = read_data_status(reader)
            reader.close()
        finally:
            event.remove(engine, "after_cursor_execute", after_execute)

        assert state["fired"]
        _assert_reconciled(inflight)
        assert _status_image(inflight) in {before, after}
        later = sessions()
        follow_up = read_data_status(later)
        _assert_reconciled(follow_up)
        assert _status_image(follow_up) == after
        later.close()
        writer.close()
        engine.dispose()


def _iso_z(value: datetime) -> str:
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def test_clock_sample_does_not_observe_a_quote_committed_during_the_sample(monkeypatch):
    """The WAL view is fixed before the Python clock. A quote committed inside that sample stays out."""
    pre = (1, 1, 0, 1, 0, (0, 0, 0, 0))
    post = (1, 1, 1, 0, 0, (0, 1, 0, 0))
    with TemporaryDirectory() as folder:
        engine = create_engine(
            f"sqlite:///{folder}/clock-pin.db",
            connect_args={"check_same_thread": False, "timeout": 5},
            future=True,
        )

        @event.listens_for(engine, "connect")
        def _wal(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

        Base.metadata.create_all(bind=engine)
        sessions = sessionmaker(bind=engine, autoflush=False, future=True)
        seed = sessions()
        _symbol(seed, "CLOCK")
        seed.commit()
        seed.close()

        writer = sessions()
        captured = {}

        def sample_then_commit():
            sampled = datetime.now(timezone.utc).replace(tzinfo=None)
            fetched_at = datetime.now(timezone.utc).replace(tzinfo=None)
            if fetched_at <= sampled:
                fetched_at = sampled + timedelta(microseconds=1)
            captured["sampled"] = sampled
            captured["fetched_at"] = fetched_at
            _quote(
                writer,
                "CLOCK",
                Decimal("10"),
                quote_at=sampled - timedelta(hours=1),
                fetched_at=fetched_at,
            )
            writer.commit()
            return sampled

        import app.core.read_snapshot as read_snapshot

        real_clock = read_snapshot._python_utc_now
        monkeypatch.setattr(read_snapshot, "_python_utc_now", sample_then_commit)
        try:
            reader = sessions()
            inflight = read_data_status(reader)
            reader.close()
            monkeypatch.setattr(read_snapshot, "_python_utc_now", real_clock)
        finally:
            if writer.in_transaction():
                writer.rollback()

        try:
            _assert_reconciled(inflight)
            assert _census_image(inflight) == pre
            assert inflight["read_at"] == _iso_z(captured["sampled"])
            assert captured["fetched_at"] > captured["sampled"]

            later = sessions()
            follow = read_data_status(later)
            later.close()
            _assert_reconciled(follow)
            assert _census_image(follow) == post
            follow_clock = datetime.fromisoformat(follow["read_at"].replace("Z", "+00:00")).replace(tzinfo=None)
            assert follow_clock > captured["fetched_at"]
        finally:
            writer.close()
            engine.dispose()


def _census_image(body):
    quote = body["quote_census"]
    counts = quote["status_counts"]
    return (
        body["universe"]["active_non_test_symbols"],
        quote["eligible_symbol_count"],
        quote["cached_quote_rows"],
        quote["missing_cache_rows"],
        quote["invalid_quote_rows"],
        (counts["live-ish"], counts["delayed"], counts["cached"], counts["stale"]),
    )
