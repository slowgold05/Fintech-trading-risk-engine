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
from app.services.massive_client import http_get_massive
from app.services.massive_ingestion import backfill_two_years, ingest_one_day


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

    def spy(db, day, symbols, api_key, http_get=http_get_massive):
        calls.append(day)
        return original(db, day, symbols, api_key, http_get=http_get)

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


def test_http_get_massive_puts_the_day_and_key_in_the_url_and_rejects_non_200(monkeypatch):
    day = date(2026, 11, 10)
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
