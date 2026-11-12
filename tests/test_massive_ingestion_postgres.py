"""Massive ingestion against disposable PostgreSQL.

Skipped unless AUDIT_DATABASE_URL is set. Upgrade uses the same Alembic
command invocation as test_audit_postgres. The schema is not dropped.
"""

from datetime import date
from decimal import Decimal
import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.models.market_symbol import MarketSymbol
from app.services.massive_ingestion import ingest_one_day
from tests.test_massive_ingestion import _grouped, _http_get, _ticker


pytestmark = pytest.mark.skipif(not os.environ.get("AUDIT_DATABASE_URL"), reason="AUDIT_DATABASE_URL is not set")

_DAY = date(2026, 11, 10)
_HEAD = "45d85a1871f0"
_CHECKS = {
    "ck_market_bars_daily_adjustment",
    "ck_market_bars_daily_ohlc",
    "ck_market_bars_daily_prices",
    "ck_market_bars_daily_provider",
    "ck_market_bars_daily_quality",
    "ck_market_bars_daily_volume",
}
_PRICES = (
    {"open": Decimal("10"), "high": Decimal("12"), "low": Decimal("9"), "close": Decimal("11")},
    {"open": Decimal("20"), "high": Decimal("22"), "low": Decimal("19"), "close": Decimal("21")},
    {"open": Decimal("30"), "high": Decimal("33"), "low": Decimal("29"), "close": Decimal("31")},
)


def _engine():
    return create_engine(os.environ["AUDIT_DATABASE_URL"], poolclass=NullPool, future=True)


def _upgrade() -> None:
    from alembic import command
    from alembic.config import Config

    owner_url = os.environ["AUDIT_DATABASE_URL"]
    os.environ["MIGRATION_DATABASE_URL"] = owner_url
    config = Config("alembic.ini")
    command.upgrade(config, "head")


def _symbols() -> list[str]:
    token = uuid4().hex[:8].upper()
    return [f"A{token}", f"B{token}", f"C{token}"]


def _seed(db, symbols) -> None:
    for symbol in symbols:
        db.add(MarketSymbol(symbol=symbol, company_name="Fixture", exchange="NASDAQ"))


def _valid_payload(symbols):
    first, second, third = symbols
    return _grouped([
        _ticker(first, 11, open_=10, high=12, low=9),
        _ticker(second, 21, open_=20, high=22, low=19),
        _ticker(third, 31, open_=30, high=33, low=29),
    ])


def _stored_bars(engine, symbols):
    """Read committed rows on a new connection. Not the ingestion session."""
    first, second, third = symbols
    with engine.connect() as connection:
        return connection.execute(text(
            "SELECT symbol, session_date, provider, adjustment_type, "
            "open, high, low, close, volume, quality_status "
            "FROM market_bars_daily "
            "WHERE symbol IN (:first, :second, :third) "
            "ORDER BY symbol"
        ), {"first": first, "second": second, "third": third}).all()


def _assert_stored_valid(row, prices) -> None:
    assert row.session_date == _DAY
    assert row.provider == "massive"
    assert row.adjustment_type == "raw"
    assert row.quality_status == "valid"
    assert row.open == prices["open"]
    assert row.high == prices["high"]
    assert row.low == prices["low"]
    assert row.close == prices["close"]
    assert row.volume == 100
    assert row.provider == row.provider.strip() and row.provider != ""
    assert row.low <= row.open <= row.high
    assert row.low <= row.close <= row.high
    for price in (row.open, row.high, row.low, row.close):
        assert Decimal("0") < price < Decimal("1000000000000")
    assert row.volume >= 0


def test_migrations_create_market_bars_daily_checks_on_disposable_postgres():
    _upgrade()
    engine = _engine()
    try:
        with engine.connect() as connection:
            version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
            names = connection.execute(text(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid = 'market_bars_daily'::regclass AND contype = 'c'"
            )).scalars().all()
        assert version == _HEAD
        assert set(names) == _CHECKS
    finally:
        engine.dispose()


def test_ingest_one_day_persists_three_valid_rows_on_postgres():
    _upgrade()
    engine = _engine()
    Session = sessionmaker(bind=engine, future=True)
    symbols = _symbols()
    payload = _valid_payload(symbols)
    try:
        with Session() as db:
            _seed(db, symbols)
            report = ingest_one_day(db, _DAY, symbols, "test-key", _http_get(payload, _DAY))
            db.commit()
        assert report == {
            "day": "2026-11-10",
            "requested": 3,
            "written_valid": 3,
            "written_flagged": 0,
            "rejected": [],
            "missing": [],
        }
        rows = _stored_bars(engine, symbols)
        assert [row.symbol for row in rows] == symbols
        for row, prices in zip(rows, _PRICES):
            _assert_stored_valid(row, prices)
    finally:
        engine.dispose()


def test_ingest_one_day_second_call_keeps_three_rows_on_postgres():
    _upgrade()
    engine = _engine()
    Session = sessionmaker(bind=engine, future=True)
    symbols = _symbols()
    payload = _valid_payload(symbols)
    http_get = _http_get(payload, _DAY)
    try:
        with Session() as db:
            _seed(db, symbols)
            first = ingest_one_day(db, _DAY, symbols, "test-key", http_get)
            second = ingest_one_day(db, _DAY, symbols, "test-key", http_get)
            db.commit()
        assert first["written_valid"] == 3
        assert second["written_valid"] == 3
        rows = _stored_bars(engine, symbols)
        assert len(rows) == 3
        assert [row.symbol for row in rows] == symbols
    finally:
        engine.dispose()


def test_ingest_one_day_rejects_inverted_ohlc_before_insert_on_postgres():
    _upgrade()
    engine = _engine()
    Session = sessionmaker(bind=engine, future=True)
    symbols = _symbols()
    first, second, inverted = symbols
    payload = _grouped([
        _ticker(first, 11, open_=10, high=12, low=9),
        _ticker(second, 21, open_=20, high=22, low=19),
        _ticker(inverted, 10, open_=10, high=9, low=12),
    ])
    try:
        with Session() as db:
            _seed(db, symbols)
            report = ingest_one_day(db, _DAY, symbols, "test-key", _http_get(payload, _DAY))
            db.commit()
        assert report["written_valid"] == 2
        assert report["written_flagged"] == 0
        assert report["rejected"] == [inverted]
        assert report["missing"] == []
        rows = _stored_bars(engine, symbols)
        assert [row.symbol for row in rows] == [first, second]
        assert inverted not in [row.symbol for row in rows]
        for row, prices in zip(rows, _PRICES[:2]):
            _assert_stored_valid(row, prices)
    finally:
        engine.dispose()


def test_teardown_leaves_the_schema_in_place():
    _upgrade()
    engine = _engine()
    try:
        with engine.connect() as connection:
            version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
            table = connection.execute(text("SELECT to_regclass('public.market_bars_daily')")).scalar()
        assert version == _HEAD
        assert table is not None
    finally:
        engine.dispose()
    reopened = _engine()
    try:
        with reopened.connect() as connection:
            version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
            table = connection.execute(text("SELECT to_regclass('public.market_bars_daily')")).scalar()
        assert version == _HEAD
        assert table is not None
    finally:
        reopened.dispose()
