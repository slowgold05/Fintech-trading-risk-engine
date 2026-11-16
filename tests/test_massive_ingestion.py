"""Massive ingestion writer. HTTP is mocked; nothing here calls the live API."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
import requests
from sqlalchemy import event

import app.services.massive_ingestion as massive_ingestion
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.services.exchange_calendar import expected_session_dates
from app.services.market_history import two_calendar_years_before
from app.services.market_providers import ProviderUnavailable
from app.services.massive_client import RequestPacer, http_get_massive
from app.services.massive_ingestion import (
    backfill_two_years,
    empty_session_skip_reason,
    ingest_one_day,
    latest_finished_nyse_session,
)


def _seed_symbols(db, symbols) -> None:
    for symbol in symbols:
        db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ"))
    db.commit()


def _grouped(rows) -> dict:
    return {"status": "OK", "results": rows}


def _ticker(symbol, close, *, open_=None, high=None, low=None, volume=100) -> dict:
    price = close
    return {
        "T": symbol,
        "o": price if open_ is None else open_,
        "h": price if high is None else high,
        "l": price if low is None else low,
        "c": price,
        "v": volume,
    }


def _http_get(payload, day=None, api_key="test-key"):
    def http_get(kind, arg, key):
        assert kind == "massive"
        assert key == api_key
        if day is not None:
            assert arg == day
        return payload

    return http_get


def test_ingest_one_day_writes_valid_rows_for_requested_symbols(db_session):
    day = date(2026, 11, 10)
    symbols = ["AAPL", "MSFT", "NVDA"]
    _seed_symbols(db_session, symbols)
    payload = _grouped([
        _ticker("AAPL", 11, open_=10, high=12, low=9),
        _ticker("MSFT", 21, open_=20, high=22, low=19),
        _ticker("NVDA", 31, open_=30, high=33, low=29),
    ])

    # SQLite stores datetimes as strings and reloads them naive. Capture the
    # value before the binder runs so the timezone-aware write is what we check.
    written_at = []

    def _capture(session, flush_context, instances):
        for obj in list(session.new) + list(session.dirty):
            if isinstance(obj, MarketBarDaily) and obj.fetched_at is not None:
                written_at.append(obj.fetched_at)

    event.listen(db_session, "before_flush", _capture)
    try:
        report = ingest_one_day(db_session, day, symbols, "test-key", _http_get(payload, day))
        again = ingest_one_day(db_session, day, symbols, "test-key", _http_get(payload, day))
    finally:
        event.remove(db_session, "before_flush", _capture)

    assert report == {
        "day": "2026-11-10",
        "requested": 3,
        "written_valid": 3,
        "written_flagged": 0,
        "rejected": [],
        "missing": [],
    }
    rows = db_session.query(MarketBarDaily).order_by(MarketBarDaily.symbol).all()
    assert len(rows) == 3
    assert [row.symbol for row in rows] == symbols
    assert all(row.provider == "massive" for row in rows)
    assert all(row.adjustment_type == "raw" for row in rows)
    assert all(row.quality_status == "valid" for row in rows)
    assert all(row.session_date == day for row in rows)
    assert written_at
    assert all(value.tzinfo is not None and value.utcoffset() == timedelta(0) for value in written_at)
    assert again["written_valid"] == 3
    assert db_session.query(MarketBarDaily).count() == 3


def test_ingest_one_day_reports_symbols_missing_from_the_provider(db_session):
    day = date(2026, 11, 10)
    symbols = ["AAPL", "MSFT", "NVDA", "ZZZZ"]
    _seed_symbols(db_session, symbols)
    payload = _grouped([
        _ticker("AAPL", 11, open_=10, high=12, low=9),
        _ticker("MSFT", 21, open_=20, high=22, low=19),
        _ticker("NVDA", 31, open_=30, high=33, low=29),
    ])

    report = ingest_one_day(db_session, day, symbols, "test-key", _http_get(payload, day))

    assert report["requested"] == 4
    assert report["written_valid"] == 3
    assert report["written_flagged"] == 0
    assert report["rejected"] == []
    assert report["missing"] == ["ZZZZ"]
    stored = {row.symbol: row.quality_status for row in db_session.query(MarketBarDaily).all()}
    assert stored == {"AAPL": "valid", "MSFT": "valid", "NVDA": "valid"}


def test_ingest_one_day_flags_a_bar_that_fails_the_jump_check(db_session):
    day = date(2026, 11, 10)
    symbols = ["AAPL", "MSFT", "NVDA"]
    _seed_symbols(db_session, symbols)
    db_session.add(MarketBarDaily(
        symbol="MSFT",
        session_date=day - timedelta(days=1),
        provider="massive",
        adjustment_type="raw",
        open=Decimal("100"),
        high=Decimal("100"),
        low=Decimal("100"),
        close=Decimal("100"),
        volume=100,
        fetched_at=datetime(2026, 11, 9, tzinfo=timezone.utc),
        quality_status="valid",
    ))
    db_session.commit()
    payload = _grouped([
        _ticker("AAPL", 11, open_=10, high=12, low=9),
        _ticker("MSFT", 180, open_=100, high=200, low=100),
        _ticker("NVDA", 31, open_=30, high=33, low=29),
    ])

    report = ingest_one_day(db_session, day, symbols, "test-key", _http_get(payload, day))

    assert report["written_valid"] == 2
    assert report["written_flagged"] == 1
    assert report["rejected"] == []
    assert report["missing"] == []
    today_rows = {
        row.symbol: row
        for row in db_session.query(MarketBarDaily).filter(MarketBarDaily.session_date == day)
    }
    assert set(today_rows) == set(symbols)
    assert today_rows["MSFT"].quality_status == "flagged"
    assert today_rows["MSFT"].close == Decimal("180")
    assert today_rows["AAPL"].quality_status == "valid"
    assert today_rows["NVDA"].quality_status == "valid"


def test_backfill_two_years_attempts_every_expected_session(db_session, monkeypatch):
    today = date(2026, 11, 11)
    expected_days = expected_session_dates(two_calendar_years_before(today), today)
    assert len(expected_days) > 400
    _seed_symbols(db_session, ["AAPL"])
    calls = []
    original = massive_ingestion.ingest_one_day

    def spy(db, day, symbols, api_key, http_get=http_get_massive, **kwargs):
        calls.append(day)
        return original(db, day, symbols, api_key, http_get=http_get, **kwargs)

    monkeypatch.setattr(massive_ingestion, "ingest_one_day", spy)
    payload = _grouped([_ticker("AAPL", 10, open_=10, high=11, low=9)])

    report = backfill_two_years(
        db_session,
        ["AAPL"],
        "test-key",
        http_get=_http_get(payload),
        today=today,
    )

    assert calls == expected_days
    assert report["sessions_attempted"] == len(expected_days)
    assert len(report["per_day"]) == len(expected_days)
    assert report["sessions_with_data"] == len(expected_days)
    assert report["symbols_fully_covered"] == ["AAPL"]
    assert report["symbols_with_gaps"] == {}


def test_backfill_two_years_survives_a_provider_outage_on_one_day(db_session):
    today = date(2026, 11, 11)
    expected_days = expected_session_dates(two_calendar_years_before(today), today)
    _seed_symbols(db_session, ["AAPL"])
    outage_day = expected_days[len(expected_days) // 2]
    payload = _grouped([_ticker("AAPL", 10, open_=10, high=11, low=9)])

    def http_get(kind, arg, key):
        assert kind == "massive"
        if arg == outage_day:
            raise ProviderUnavailable("massive returned 503")
        return payload

    report = backfill_two_years(
        db_session,
        ["AAPL"],
        "test-key",
        http_get=http_get,
        today=today,
    )

    assert report["sessions_attempted"] == len(expected_days)
    assert len(report["per_day"]) == len(expected_days)
    assert report["sessions_failed"] == 1
    assert report["sessions_with_data"] == len(expected_days) - 1
    assert report["symbols_with_gaps"] == {"AAPL": [outage_day.isoformat()]}


def test_backfill_two_years_survives_a_malformed_payload_on_one_day(db_session):
    """parse_massive_grouped raises ValueError, not ProviderUnavailable, on a bad payload."""
    today = date(2026, 11, 11)
    expected_days = expected_session_dates(two_calendar_years_before(today), today)
    _seed_symbols(db_session, ["AAPL"])
    bad_day = expected_days[len(expected_days) // 2]
    payload = _grouped([_ticker("AAPL", 10, open_=10, high=11, low=9)])

    def http_get(kind, arg, key):
        assert kind == "massive"
        if arg == bad_day:
            return {"status": "ERROR"}
        return payload

    report = backfill_two_years(
        db_session,
        ["AAPL"],
        "test-key",
        http_get=http_get,
        today=today,
    )

    assert report["sessions_attempted"] == len(expected_days)
    assert report["sessions_failed"] == 1
    assert report["sessions_with_data"] == len(expected_days) - 1
    assert report["symbols_with_gaps"] == {"AAPL": [bad_day.isoformat()]}
    failed_report = next(r for r in report["per_day"] if r["day"] == bad_day.isoformat())
    assert failed_report["error"] == "Massive grouped payload is incomplete"
    assert failed_report["missing"] == ["AAPL"]
    stored_days = {row.session_date for row in db_session.query(MarketBarDaily).all()}
    assert bad_day not in stored_days
    assert len(stored_days) == len(expected_days) - 1


def test_backfill_skips_a_finished_day_that_has_fewer_symbols_than_a_later_one(db_session, monkeypatch):
    days = [date(2026, 11, 10), date(2026, 11, 12), date(2026, 11, 13)]
    monkeypatch.setattr(massive_ingestion, "expected_session_dates", lambda start, end: days)
    symbols = ["AAPL", "MSFT"]
    _seed_symbols(db_session, symbols)
    _insert_bar(db_session, "AAPL", days[0])
    _insert_bar(db_session, "AAPL", days[1])
    _insert_bar(db_session, "MSFT", days[1])
    calls = []

    def http_get(kind, arg, key):
        calls.append(arg)
        return _grouped([
            _ticker("AAPL", 10, open_=10, high=11, low=9),
            _ticker("MSFT", 20, open_=20, high=22, low=19),
        ])

    report = backfill_two_years(
        db_session,
        symbols,
        "test-key",
        http_get=http_get,
        today=days[-1],
    )

    assert calls == [days[2]]
    assert report["sessions_attempted"] == 3
    assert report["sessions_skipped"] == 2
    assert report["sessions_with_data"] == 3
    assert report["sessions_failed"] == 0
    older = next(item for item in report["per_day"] if item["day"] == days[0].isoformat())
    newer = next(item for item in report["per_day"] if item["day"] == days[1].isoformat())
    assert older["skipped"] is True
    assert older["missing"] == ["MSFT"]
    assert newer["skipped"] is True
    assert newer["missing"] == []
    assert db_session.query(MarketBarDaily).count() == 5


def _insert_bar(db, symbol, day) -> None:
    db.add(MarketBarDaily(
        symbol=symbol,
        session_date=day,
        provider="massive",
        adjustment_type="raw",
        open=Decimal("10"),
        high=Decimal("11"),
        low=Decimal("9"),
        close=Decimal("10"),
        volume=100,
        fetched_at=datetime.now(timezone.utc),
        quality_status="valid",
    ))
    db.commit()


def test_http_get_massive_puts_the_day_and_key_in_the_url_and_rejects_non_200(monkeypatch):
    day = date(2026, 11, 10)
    monkeypatch.setattr(
        "app.services.massive_client.get_shared_pacer",
        lambda: RequestPacer(4.8, sleep=lambda _seconds: None),
    )
    seen = []

    def fake_get(*args, **kwargs):
        seen.append(args[0] if args else kwargs.get("url"))
        return SimpleNamespace(status_code=200, json=lambda: {"status": "OK", "results": []})

    monkeypatch.setattr("app.services.massive_client.requests.get", fake_get)
    body = http_get_massive("massive", day, "test-key")
    assert body == {"status": "OK", "results": []}
    assert "2026-11-10" in seen[0]
    assert "test-key" in seen[0]
    assert "https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/" in seen[0]
    assert "adjusted=false" in seen[0]

    def fake_denied(*args, **kwargs):
        return SimpleNamespace(status_code=503)

    monkeypatch.setattr("app.services.massive_client.requests.get", fake_denied)
    with pytest.raises(ProviderUnavailable, match="503"):
        http_get_massive("massive", day, "test-key")

    def fake_timeout(*args, **kwargs):
        raise requests.Timeout("timed out")

    monkeypatch.setattr("app.services.massive_client.requests.get", fake_timeout)
    with pytest.raises(ProviderUnavailable, match="Timeout"):
        http_get_massive("massive", day, "test-key")


def test_backfill_status_filename_is_not_tied_to_a_worker_session():
    from app.scripts.backfill_massive_history import DEFAULT_STATUS_FILENAME

    assert DEFAULT_STATUS_FILENAME == "massive-backfill-status.json"


def test_empty_session_before_the_latest_finished_day_is_closed():
    today = date(2026, 11, 13)
    finished = latest_finished_nyse_session(today)
    assert finished == date(2026, 11, 12)
    assert empty_session_skip_reason(date(2026, 11, 10), today) == "market_closed"
    assert empty_session_skip_reason(finished, today) == "not_yet_available"
    assert empty_session_skip_reason(today, today) == "not_yet_available"
    monday = date(2026, 11, 16)
    assert latest_finished_nyse_session(monday) == date(2026, 11, 13)
    assert empty_session_skip_reason(date(2026, 11, 13), monday) == "not_yet_available"
    assert empty_session_skip_reason(date(2026, 11, 12), monday) == "market_closed"


def test_empty_grouped_day_is_skipped_and_not_requested_again(db_session, monkeypatch):
    # 2026-11-10 is strictly before the latest finished session when the window
    # ends on 2026-11-13 (finished session 2026-11-12).
    closed_session = date(2026, 11, 10)
    days = [closed_session, date(2026, 11, 12), date(2026, 11, 13)]
    monkeypatch.setattr(massive_ingestion, "expected_session_dates", lambda start, end: days)
    _seed_symbols(db_session, ["AAPL"])
    calls = []

    def http_get(kind, arg, key):
        calls.append(arg)
        if arg == closed_session:
            return {"status": "OK", "resultsCount": 0, "queryCount": 0}
        return _grouped([_ticker("AAPL", 10, open_=10, high=11, low=9)])

    closed: set[date] = set()
    report = backfill_two_years(
        db_session, ["AAPL"], "test-key", http_get=http_get, today=days[-1], closed_dates=closed,
    )

    assert calls == days
    assert closed == {closed_session}
    assert report["sessions_failed"] == 0
    assert report["sessions_not_yet_available"] == 0
    assert report["sessions_skipped"] == 1
    assert report["symbols_with_gaps"] == {}
    closed_day = next(item for item in report["per_day"] if item["day"] == closed_session.isoformat())
    assert closed_day["skipped"] is True
    assert closed_day["skip_reason"] == "market_closed"
    assert closed_day["missing"] == []
    assert "error" not in closed_day

    calls.clear()
    again = backfill_two_years(
        db_session, ["AAPL"], "test-key", http_get=http_get, today=days[-1], closed_dates=closed,
    )
    assert closed_session not in calls
    assert again["sessions_failed"] == 0
    assert again["sessions_skipped"] >= 1


def test_empty_last_session_is_not_remembered_and_is_requested_again(db_session, monkeypatch):
    days = [date(2026, 11, 12), date(2026, 11, 13)]
    monkeypatch.setattr(massive_ingestion, "expected_session_dates", lambda start, end: days)
    _seed_symbols(db_session, ["AAPL"])
    calls = []

    def http_get(kind, arg, key):
        calls.append(arg)
        if arg == days[-1]:
            return {"status": "OK", "results": []}
        return _grouped([_ticker("AAPL", 10, open_=10, high=11, low=9)])

    closed: set[date] = set()
    report = backfill_two_years(
        db_session, ["AAPL"], "test-key", http_get=http_get, today=days[-1], closed_dates=closed,
    )

    assert calls == days
    assert closed == set()
    assert report["sessions_failed"] == 0
    assert report["sessions_not_yet_available"] == 1
    assert report["sessions_with_data"] == 1
    assert report["symbols_with_gaps"] == {"AAPL": [days[-1].isoformat()]}
    last = next(item for item in report["per_day"] if item["day"] == days[-1].isoformat())
    assert last["skipped"] is True
    assert last["skip_reason"] == "not_yet_available"
    assert last["missing"] == ["AAPL"]
    assert "error" not in last

    calls.clear()
    again = backfill_two_years(
        db_session, ["AAPL"], "test-key", http_get=http_get, today=days[-1], closed_dates=closed,
    )
    assert calls == [days[-1]]
    assert closed == set()
    assert again["sessions_failed"] == 0
    assert again["sessions_not_yet_available"] == 1
    assert again["symbols_with_gaps"] == {"AAPL": [days[-1].isoformat()]}


def test_observed_carter_closure_is_skipped_without_a_request(db_session, monkeypatch):
    from app.scripts.backfill_massive_history import OBSERVED_CLOSED_SESSIONS

    closed_day = date(2025, 1, 9)
    open_day = date(2025, 1, 10)
    assert closed_day in OBSERVED_CLOSED_SESSIONS
    monkeypatch.setattr(massive_ingestion, "expected_session_dates", lambda start, end: [closed_day, open_day])
    _seed_symbols(db_session, ["AAPL"])
    calls = []

    def http_get(kind, arg, key):
        calls.append(arg)
        return _grouped([_ticker("AAPL", 10, open_=10, high=11, low=9)])

    report = backfill_two_years(
        db_session,
        ["AAPL"],
        "test-key",
        http_get=http_get,
        today=open_day,
        closed_dates=set(OBSERVED_CLOSED_SESSIONS),
    )

    assert calls == [open_day]
    assert report["sessions_failed"] == 0
    skipped = next(item for item in report["per_day"] if item["day"] == closed_day.isoformat())
    assert skipped["skip_reason"] == "market_closed"
    assert skipped["missing"] == []
