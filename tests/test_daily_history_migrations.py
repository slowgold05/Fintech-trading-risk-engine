"""Canonical history migration proofs on an explicitly disposable PostgreSQL instance."""

import hashlib
import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.models.market_symbol import MarketSymbol
from app.models.price_history_daily import PriceHistoryDaily
from app.models.user import User
from app.scripts.configure_postgres_role import configure
from app.services.ledger_service import ensure_opening

pytestmark = pytest.mark.skipif(not os.environ.get("AUDIT_DATABASE_URL"), reason="AUDIT_DATABASE_URL is not set")

PREVIOUS = "f3a8c2d7e961"
CURRENT = "a21c9e7d4b60"


@pytest.fixture
def isolated_history_database(monkeypatch):
    owner = make_url(os.environ["AUDIT_DATABASE_URL"])
    assert owner.get_backend_name() == "postgresql"
    name = "p1b_schema_" + uuid4().hex
    admin = create_engine(owner, isolation_level="AUTOCOMMIT")
    engine = None
    try:
        with admin.connect() as db:
            db.exec_driver_sql(f'CREATE DATABASE "{name}"')
        target = owner.set(database=name)
        monkeypatch.setenv("MIGRATION_DATABASE_URL", target.render_as_string(hide_password=False))
        engine = create_engine(target)
        with engine.connect() as db:
            assert db.execute(text("SELECT current_database()")).scalar_one() == name
        yield engine, target
    finally:
        if engine is not None:
            engine.dispose()
        assert name.startswith("p1b_schema_") and len(name) == len("p1b_schema_") + 32
        with admin.connect() as db:
            db.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
        admin.dispose()


def _digests(engine):
    result = {}
    with engine.connect() as db:
        for table in inspect(db).get_table_names():
            if table in {"alembic_version", "market_bars_daily"}:
                continue
            quoted = db.dialect.identifier_preparer.quote(table)
            rows = db.exec_driver_sql(f"SELECT * FROM {quoted}").all()
            encoded = sorted(json.dumps(list(row), default=str) for row in rows)
            result[table] = hashlib.sha256("\n".join(encoded).encode()).hexdigest()
    return result


@pytest.mark.parametrize("from_previous", [False, True], ids=["fresh", "upgrade"])
def test_history_schema_preserves_legacy_data_and_scoped_grants(isolated_history_database, from_previous):
    engine, owner = isolated_history_database
    config = Config("alembic.ini")
    before = None
    if from_previous:
        command.upgrade(config, PREVIOUS)
        with Session(engine) as db:
            user = User(email="history-migration@example.com", password_hash="fixture", cash_balance=Decimal("100000"))
            db.add_all([user, MarketSymbol(symbol="P1B", company_name="Fixture", exchange="NASDAQ")])
            db.flush()
            ensure_opening(db, user)
            db.add(PriceHistoryDaily(symbol="P1B", date=date(2026, 11, 4), open=10, high=12, low=9, close=11, volume=100, source="legacy-fixture"))
            db.commit()
        before = _digests(engine)

    command.upgrade(config, CURRENT)
    with engine.connect() as db:
        assert db.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == CURRENT
        assert db.execute(text("SELECT count(*) FROM market_bars_daily")).scalar_one() == 0
    if before is not None:
        assert _digests(engine) == before
    else:
        with Session(engine) as db:
            db.add(MarketSymbol(symbol="P1B", company_name="Fixture", exchange="NASDAQ"))
            db.commit()

    password = uuid4().hex
    configure(owner.render_as_string(hide_password=False), password)
    app_engine = create_engine(owner.set(username="fintech_app", password=password))
    try:
        values = {"symbol": "P1B", "session_date": date(2026, 11, 4), "provider": "fixture",
                  "adjustment_type": "raw", "open": Decimal("10"), "high": Decimal("12"),
                  "low": Decimal("9"), "close": Decimal("11"), "volume": 100,
                  "fetched_at": datetime.now(timezone.utc), "quality_status": "valid"}
        statement = text("INSERT INTO market_bars_daily (symbol, session_date, provider, adjustment_type, open, high, low, close, volume, fetched_at, quality_status) VALUES (:symbol, :session_date, :provider, :adjustment_type, :open, :high, :low, :close, :volume, :fetched_at, :quality_status)")
        with app_engine.begin() as db:
            db.execute(statement, values)
            db.execute(text("UPDATE market_bars_daily SET volume = 101 WHERE symbol = 'P1B'"))
        with app_engine.begin() as db:
            assert db.execute(text("SELECT volume FROM market_bars_daily")).scalar_one() == 101
        for price in (Decimal("NaN"), Decimal("Infinity"), Decimal("-1"), Decimal("0")):
            with pytest.raises(DBAPIError), app_engine.begin() as db:
                db.execute(statement, {**values, "provider": "invalid", "open": price})
        with pytest.raises(IntegrityError), app_engine.begin() as db:
            db.execute(statement, values)
        with pytest.raises(DBAPIError), app_engine.begin() as db:
            db.execute(text("UPDATE users SET role = 'admin'"))
        with pytest.raises(DBAPIError), app_engine.begin() as db:
            db.execute(text("DELETE FROM ledger_entries"))
        with app_engine.begin() as db:
            db.execute(text("DELETE FROM market_bars_daily WHERE symbol = 'P1B'"))
    finally:
        app_engine.dispose()

    command.downgrade(config, PREVIOUS)
    assert "market_bars_daily" not in inspect(engine).get_table_names()
    if before is not None:
        assert _digests(engine) == before
