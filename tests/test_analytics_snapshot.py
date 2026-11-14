"""Zero-capital analytics and one risk snapshot.

Chart ranges stay on market history. Performance and risk accept only 1y and 2y.
Dollar fields stay numeric at zero capital. Growth, drawdown, Dietz, and stress
percentages stay null when the ratio is undefined. Risk metrics read performance,
valuation, allocation, and closes in one transaction and one clock.
"""

from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
import os
from tempfile import TemporaryDirectory

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.core.database import Base
from app.core.security import hash_password
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry  # noqa: F401  (register table)
from app.models.lot import Lot  # noqa: F401  (register table)
from app.models.market_bar_daily import MarketBarDaily  # noqa: F401  (register table)
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol  # noqa: F401  (register table)
from app.models.order import Order  # noqa: F401  (register table)
from app.models.trade import Trade  # noqa: F401  (register table)
from app.models.user import User
from app.services.cash_movements import post_movement
from app.services.market_history import (
    SUPPORTED_RANGES,
    one_calendar_year_before,
    two_calendar_years_before,
)
from app.services.performance_service import build_performance_response
from app.services.portfolio_risk import (
    _beta,
    _defined_index_returns,
    _paired_index_returns,
    _stress_scenarios,
    build_risk_metrics_response,
)
from tests.test_portfolio_performance import (
    _pin_clock,
    _reference_sessions,
    _replace_opening,
    _stamp_after,
)
from tests.test_portfolio_risk import _install_series
from tests.test_portfolio_valuation import _add_position, _add_quote, _add_symbol, _forbid_providers


def _finite(value):
    if isinstance(value, dict):
        for item in value.values():
            _finite(item)
        return
    if isinstance(value, list):
        for item in value:
            _finite(item)
        return
    if isinstance(value, str):
        assert "Infinity" not in value
        assert "NaN" not in value
        return
    if isinstance(value, float):
        assert value == value
        assert value != float("inf")
        assert value != float("-inf")


def _by_date(body):
    return {point["session_date"]: point for point in body["series"]}


def test_chart_ranges_stay_on_market_history_and_analytics_reject_them(client, auth_headers, db_session):
    assert SUPPORTED_RANGES == frozenset({"1m", "3m", "6m", "1y", "2y", "all"})
    headers = auth_headers("analytics-range@example.com")
    user = db_session.query(User).one()
    detail = "range must be 1y or 2y."
    for token in ("1m", "3m", "6m", "all"):
        for path in ("/portfolio/performance", "/portfolio/risk-metrics"):
            response = client.get(path, headers=headers, params={"range": token})
            assert response.status_code == 422, path
            assert response.json()["detail"] == detail
        with pytest.raises(HTTPException) as performance_error:
            build_performance_response(db_session, user.id, user.email, token)
        with pytest.raises(HTTPException) as risk_error:
            build_risk_metrics_response(db_session, user.id, user.email, token)
        assert performance_error.value.status_code == 422
        assert risk_error.value.status_code == 422
        assert performance_error.value.detail == detail
        assert risk_error.value.detail == detail


def test_performance_range_bounds_follow_one_and_two_calendar_years(
    client, auth_headers, db_session, monkeypatch,
):
    _forbid_providers(monkeypatch)
    days = _reference_sessions()
    clock = datetime.combine(days[-1], time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("analytics-bounds@example.com")
    user = db_session.query(User).one()
    _replace_opening(db_session, user, Decimal("1000.00"), datetime.combine(days[0], time(14, 0)))
    db_session.commit()

    one = client.get("/portfolio/performance", headers=headers, params={"range": "1y"})
    two = client.get("/portfolio/performance", headers=headers, params={"range": "2y"})
    assert one.status_code == 200, one.text
    assert two.status_code == 200, two.text
    assert one.json()["requested_end"] == days[-1].isoformat()
    assert two.json()["requested_end"] == days[-1].isoformat()
    assert one.json()["requested_start"] == one_calendar_year_before(days[-1]).isoformat()
    assert two.json()["requested_start"] == two_calendar_years_before(days[-1]).isoformat()
    direct = build_performance_response(db_session, user.id, user.email, "1y")
    assert direct["requested_start"] == one.json()["requested_start"]
    risk = client.get("/portfolio/risk-metrics", headers=headers, params={"range": "2y"})
    assert risk.status_code == 200, risk.text
    assert risk.json()["requested_start"] == two.json()["requested_start"]
    assert risk.json()["requested_end"] == days[-1].isoformat()


def test_full_withdrawal_seals_the_growth_chain(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    days = _reference_sessions()
    _pin_clock(monkeypatch, datetime.combine(days[-1], time(18, 0)))
    headers = auth_headers("analytics-withdraw@example.com")
    user = db_session.query(User).one()
    _replace_opening(db_session, user, Decimal("1000.00"), datetime.combine(days[0], time(14, 0)))
    from tests.test_portfolio_performance import _max_ledger_id

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "withdrawal", Decimal("1000.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(days[1], time(11, 0)))
    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "deposit", Decimal("400.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(days[2], time(11, 0)))
    db_session.commit()

    response = client.get("/portfolio/performance", headers=headers, params={"range": "1y"})
    assert response.status_code == 200, response.text
    body = response.json()
    _finite(body)
    points = _by_date(body)
    funded = points[days[0].isoformat()]
    flat = points[days[1].isoformat()]
    refunded = points[days[2].isoformat()]
    later = points[days[3].isoformat()]

    assert funded["account_value"] == "1000.00"
    assert funded["twr_index"] == "1.000000"
    assert funded["drawdown_pct"] == "0.0000"
    assert funded["daily_pnl"] is None
    assert funded["cumulative_pnl"] == "0.00"

    assert flat["account_value"] == "0.00"
    assert flat["twr_index"] == "1.000000"
    assert flat["drawdown_pct"] == "100.0000"
    assert flat["daily_pnl"] == "0.00"
    assert flat["cumulative_pnl"] == "0.00"

    assert refunded["account_value"] == "400.00"
    assert refunded["twr_index"] is None
    assert refunded["daily_pnl"] == "0.00"
    assert refunded["cumulative_pnl"] == "0.00"
    assert refunded["drawdown_pct"] == "60.0000"
    assert later["twr_index"] is None
    assert later["account_value"] == "400.00"
    assert later["daily_pnl"] == "0.00"
    assert later["cumulative_pnl"] == "0.00"


def test_empty_account_establishes_index_on_first_positive_capital(
    client, auth_headers, db_session, monkeypatch,
):
    _forbid_providers(monkeypatch)
    days = _reference_sessions()
    _pin_clock(monkeypatch, datetime.combine(days[-1], time(18, 0)))
    headers = auth_headers("analytics-empty@example.com")
    user = db_session.query(User).one()
    _replace_opening(db_session, user, Decimal("0.00"), datetime.combine(days[0], time(14, 0)))
    from tests.test_portfolio_performance import _max_ledger_id

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "deposit", Decimal("250.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(days[-1], time(11, 0)))
    db_session.commit()

    body = client.get("/portfolio/performance", headers=headers, params={"range": "1y"}).json()
    _finite(body)
    points = _by_date(body)
    empty = points[days[0].isoformat()]
    funded = points[days[-1].isoformat()]
    assert empty["account_value"] == "0.00"
    assert empty["twr_index"] is None
    assert empty["drawdown_pct"] is None
    assert empty["daily_pnl"] is None
    assert empty["cumulative_pnl"] == "0.00"
    assert funded["account_value"] == "250.00"
    assert funded["twr_index"] == "1.000000"
    assert funded["drawdown_pct"] == "0.0000"
    assert funded["daily_pnl"] == "0.00"
    assert funded["cumulative_pnl"] == "0.00"
    # The only flow is on the last day, so its Dietz weight is 0 and the
    # denominator is the zero starting value.
    assert body["money_weighted_return_pct"] is None


def test_zero_stress_keeps_dollar_loss_and_nulls_the_percentage():
    scenarios = _stress_scenarios({
        "status": "complete",
        "total_account_value": "0.00",
        "securities": [{
            "symbol": "CASHBOOK",
            "sector": "Technology",
            "position_value": "0.00",
            "price_status": "available",
            "weight_pct": "0.0000",
        }],
    })
    assert scenarios is not None
    for scenario in scenarios:
        assert scenario["loss"] == "0.00"
        assert scenario["loss_pct"] is None
    rendered = str(scenarios)
    assert "Infinity" not in rendered
    assert "NaN" not in rendered


def test_terminal_zero_index_records_total_loss_then_blocks_the_next_ratio():
    one = Decimal(1)
    zero = Decimal(0)
    assert _defined_index_returns([one, zero]) == [Decimal(-1)]
    # The zero is not a denominator, and 2 does not reach back to 1.
    assert _defined_index_returns([one, zero, Decimal(2)]) == [Decimal(-1)]
    assert _defined_index_returns([one, None, Decimal(2)]) == []
    assert _defined_index_returns([one, Decimal(-1), Decimal(2)]) == []
    assert _defined_index_returns([zero, one]) == []

    left, right = _paired_index_returns(
        [one, zero, Decimal(2)],
        [one, Decimal("1.5"), Decimal(2)],
    )
    assert left == [Decimal(-1)]
    assert right == [Decimal("0.5")]
    both_zero = _paired_index_returns([one, zero], [one, zero])
    assert both_zero == ([Decimal(-1)], [Decimal(-1)])
    blocked = _paired_index_returns([one, None, Decimal(2)], [one, one, Decimal(2)])
    assert blocked == ([], [])
    negative = _paired_index_returns([one, Decimal(-1)], [one, Decimal("1.1")])
    assert negative == ([], [])

    pair_count, beta = _beta([one, zero, Decimal(2)], [one, Decimal("1.1"), Decimal("1.2")])
    assert pair_count == 1
    assert beta is None


def test_terminal_zero_index_series_counts_the_loss_and_does_not_restart(monkeypatch):
    series = [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
        {"status": "unavailable", "twr_index": None, "drawdown_pct": None, "benchmark_index": None},
        {"status": "available", "twr_index": "0.000000", "drawdown_pct": "100.0000", "benchmark_index": "1.100000"},
        {"status": "available", "twr_index": "1.200000", "drawdown_pct": "0.0000", "benchmark_index": "1.200000"},
    ]
    _install_series(monkeypatch, series)
    body = build_risk_metrics_response(None, 7, "risk@example.com", "1y")
    _finite(body)
    assert body["observed_periods"] == 3
    assert body["return_count"] == 1
    assert body["historical_volatility_pct"] is None
    assert body["beta_pair_count"] == 1
    assert body["portfolio_beta"] is None
    assert body["max_drawdown_pct"] == "100.0000"


def test_nullable_risk_series_do_not_bridge_or_divide_by_zero(monkeypatch):
    series = [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
        {"status": "available", "twr_index": None, "drawdown_pct": None, "benchmark_index": "1.010000"},
        {"status": "available", "twr_index": "1.200000", "drawdown_pct": "0.0000", "benchmark_index": "0.000000"},
        {"status": "available", "twr_index": "1.320000", "drawdown_pct": "0.0000", "benchmark_index": "1.100000"},
    ]
    _install_series(monkeypatch, series)
    body = build_risk_metrics_response(None, 7, "risk@example.com", "1y")
    _finite(body)
    # 1.32 / 1.20 is the only defined link. 1.20 does not divide by 1.00 across the null,
    # and nothing divides by the zero benchmark.
    assert body["observed_periods"] == 4
    assert body["return_count"] == 1
    assert body["historical_volatility_pct"] is None
    assert body["max_drawdown_pct"] == "0.0000"
    assert body["beta_pair_count"] == 0
    assert body["portfolio_beta"] is None
    for field in (
        "historical_var_95_pct",
        "historical_var_99_pct",
        "expected_shortfall_95_pct",
        "expected_shortfall_99_pct",
    ):
        assert body[field] is None


def _wal_engine(path):
    engine = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False, "timeout": 5},
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _wal(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    return engine


def _insert_opening_at(db, user: User, cash: Decimal, when: datetime) -> None:
    """Insert the opening snapshot with ``when`` already on the row.

    ``append_event`` stamps ``created_at`` from ``datetime.now`` and hashes
    that value. Patching the helper clock keeps the hash and the row in
    agreement. This does not update ``ledger_entries`` after insert.
    """
    import app.services.ledger_service as ledger_service

    real_datetime = ledger_service.datetime

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            stamped = when if when.tzinfo is not None else when.replace(tzinfo=timezone.utc)
            if tz is not None:
                stamped = stamped.astimezone(tz)
            return stamped

    user.cash_balance = cash
    db.flush()
    ledger_service.datetime = _FrozenDatetime
    try:
        ledger_service.ensure_opening(db, user)
    finally:
        ledger_service.datetime = real_datetime


def _seed_risk_book(seed):
    user = User(
        email="risk-snap@example.com",
        password_hash=hash_password("password123"),
        cash_balance=Decimal("1000.00"),
    )
    seed.add(user)
    seed.flush()
    _replace_opening(seed, user, Decimal("1000.00"), datetime(2026, 3, 6, 14, 0))
    _add_position(seed, user, "AAPL", "stock", Decimal("10"), Decimal("10"))
    _add_symbol(seed, "AAPL")
    observed = datetime(2026, 3, 13, 17, 0)
    _add_quote(seed, "AAPL", Decimal("100"), quote_at=observed, fetched_at=observed)
    seed.commit()
    return user.id, user.email


def test_risk_metrics_use_one_clock_and_one_sqlite_snapshot(monkeypatch):
    days = _reference_sessions()
    _pin_clock(monkeypatch, datetime.combine(days[-1], time(18, 0)))
    _forbid_providers(monkeypatch)
    import app.services.portfolio_risk as portfolio_risk

    real_clock = portfolio_risk.snapshot_clock
    calls = {"n": 0}

    def counted(db):
        calls["n"] += 1
        return real_clock(db)

    monkeypatch.setattr(portfolio_risk, "snapshot_clock", counted)

    with TemporaryDirectory() as folder:
        engine = _wal_engine(f"{folder}/risk-snapshot.db")
        Base.metadata.create_all(bind=engine)
        sessions = sessionmaker(bind=engine, autoflush=False, future=True)
        seed = sessions()
        user_id, email = _seed_risk_book(seed)
        seed.close()

        baseline_session = sessions()
        baseline = build_risk_metrics_response(baseline_session, user_id, email, "1y")
        baseline_session.close()
        assert calls["n"] == 1
        assert baseline["stress_scenarios"][0]["loss"] == "100.00"
        calls["n"] = 0

        writer = sessions()
        state = {"fired": False}

        def apply_update():
            holding = writer.query(Holding).one()
            holding.quantity = Decimal("1")
            quote = writer.query(MarketQuoteCache).one()
            quote.price = Decimal("5")
            writer.commit()

        def after_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
            if state["fired"] or not statement:
                return
            sql = statement.lower()
            if "holdings" in sql and "market_quote_cache" in sql:
                state["fired"] = True
                apply_update()

        event.listen(engine, "after_cursor_execute", after_execute)
        try:
            reader = sessions()
            inflight = build_risk_metrics_response(reader, user_id, email, "1y")
            reader.close()
        finally:
            event.remove(engine, "after_cursor_execute", after_execute)

        assert state["fired"]
        assert calls["n"] == 1
        assert inflight == baseline
        _finite(inflight)

        later_session = sessions()
        later = build_risk_metrics_response(later_session, user_id, email, "1y")
        later_session.close()
        writer.close()
        engine.dispose()

    assert later["stress_scenarios"][0]["loss"] == "0.50"
    assert later["read_at"] == baseline["read_at"]
    assert later != baseline


@pytest.mark.skipif(not os.environ.get("AUDIT_DATABASE_URL"), reason="AUDIT_DATABASE_URL is not set")
def test_risk_metrics_repeatable_read_on_postgres(monkeypatch):
    """Disposable PostgreSQL. A commit between risk reads stays out of this snapshot.

    The allowlist runs before any connection. Schema comes from migrations.
    PostgreSQL ``current_timestamp`` is the snapshot clock, so the quote is
    dated from that database clock. The opening ledger row stays in March.
    """
    from tests.test_order_preview_postgres import _disposable_url, _upgrade

    url = _disposable_url()
    _upgrade(url)
    _forbid_providers(monkeypatch)
    engine = create_engine(url, poolclass=NullPool, future=True)
    sessions = sessionmaker(bind=engine, autoflush=False, future=True)
    email = f"risk-pg-{datetime.now(timezone.utc).strftime('%H%M%S%f')}@example.com"
    with sessions() as seed:
        user = User(email=email, password_hash="fixture", cash_balance=Decimal("1000.00"))
        seed.add(user)
        seed.flush()
        _add_position(seed, user, f"PG{user.id}", "stock", Decimal("10"), Decimal("10"))
        seed.flush()
        held = seed.query(Holding).filter(Holding.user_id == user.id).one()
        asset = seed.get(Asset, held.asset_id)
        _add_symbol(seed, asset.symbol)
        db_now = seed.execute(text("SELECT current_timestamp")).scalar_one()
        if db_now.tzinfo is not None:
            db_now = db_now.astimezone(timezone.utc).replace(tzinfo=None)
        observed = db_now - timedelta(minutes=1)
        _add_quote(seed, asset.symbol, Decimal("100"), quote_at=observed, fetched_at=observed)
        # Holding is already flushed, so the opening snapshot includes it.
        # created_at is hashed at insert. The append-only trigger rejects a later UPDATE.
        _insert_opening_at(seed, user, Decimal("1000.00"), datetime(2026, 3, 6, 14, 0))
        seed.commit()
        user_id = user.id
        asset_symbol = asset.symbol

    with sessions() as reader:
        baseline = build_risk_metrics_response(reader, user_id, email, "1y")

    fired = {"ok": False}

    def update_between(_conn, _cursor, statement, _parameters, _context, _executemany):
        if fired["ok"] or not statement:
            return
        if "holdings" not in statement.lower() or "market_quote_cache" not in statement.lower():
            return
        fired["ok"] = True
        with sessions() as writer:
            holding = writer.query(Holding).filter(Holding.user_id == user_id).one()
            holding.quantity = Decimal("1")
            quote = writer.query(MarketQuoteCache).filter(MarketQuoteCache.symbol == asset_symbol).one()
            quote.price = Decimal("5")
            writer.commit()

    event.listen(engine, "after_cursor_execute", update_between)
    try:
        with sessions() as reader:
            inflight = build_risk_metrics_response(reader, user_id, email, "1y")
        assert fired["ok"]
        assert inflight["stress_scenarios"][0]["loss"] == baseline["stress_scenarios"][0]["loss"]
        assert inflight["stress_scenarios"][0]["loss"] == "100.00"
    finally:
        event.remove(engine, "after_cursor_execute", update_between)
    with sessions() as reader:
        later = build_risk_metrics_response(reader, user_id, email, "1y")
    assert later["stress_scenarios"][0]["loss"] == "0.50"
    engine.dispose()
