"""GET /portfolio/performance daily value, time-weighted return, drawdown, daily dollar P&L, cumulative dollar P&L, the SPY benchmark index, and the window's money-weighted return.

The series numbers are the contract's independently computed reference
(docs/P4A_PERFORMANCE_CONTRACT.md sections 8, 5, 10, 11, 12, 13, and 14). They are not
derived from the service under test.
"""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.trade import Trade
from app.models.user import User
from app.services import exchange_calendar
from app.services.cash_movements import post_movement
from app.services.ledger_service import append_reset, append_trade, ensure_opening
from app.services.market_history import one_calendar_year_before, two_calendar_years_before
from app.services.performance_service import build_performance_response
from app.services.portfolio_valuation import _realized_subquery, build_portfolio_response


def _forbid_providers(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("provider called")

    monkeypatch.setattr("app.services.price_service.get_live_price", boom)
    monkeypatch.setattr("app.services.price_service.get_stock_quote", boom)
    monkeypatch.setattr("requests.get", boom)


def _pin_clock(monkeypatch, clock: datetime) -> None:
    monkeypatch.setattr("app.core.read_snapshot._python_utc_now", lambda: clock)


def _add_symbol(db, symbol, tier="daily"):
    db.add(MarketSymbol(
        symbol=symbol,
        company_name=symbol,
        exchange="NASDAQ",
        is_active=True,
        refresh_tier=tier,
    ))
    db.flush()


def _add_quote(db, symbol, price, source="yahoo", quote_at=None, fetched_at=None):
    observed = quote_at if quote_at is not None else datetime(2026, 3, 13, 17, 0)
    db.add(MarketQuoteCache(
        symbol=symbol,
        price=price,
        change_amount=0,
        change_percent=0,
        volume=0,
        source=source,
        quote_at=observed,
        fetched_at=fetched_at if fetched_at is not None else observed,
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
    close_price=Decimal("11.000000"),
):
    db.add(MarketBarDaily(
        symbol=symbol,
        session_date=session_date,
        provider=provider,
        adjustment_type=adjustment,
        open=close_price,
        high=close_price,
        low=close_price,
        close=close_price,
        volume=100,
        fetched_at=fetched_at,
        quality_status=quality,
    ))


def _max_ledger_id(db) -> int:
    value = db.query(func.max(LedgerEntry.id)).scalar()
    return int(value or 0)


def _stamp_after(db, user_id: int, before_id: int, when: datetime) -> None:
    updated = (
        db.query(LedgerEntry)
        .filter(LedgerEntry.user_id == user_id, LedgerEntry.id > before_id)
        .update({LedgerEntry.created_at: when}, synchronize_session=False)
    )
    assert updated >= 2
    db.flush()


def _replace_opening(db, user: User, cash: Decimal, when: datetime) -> None:
    db.query(LedgerEntry).filter(LedgerEntry.user_id == user.id).delete(synchronize_session=False)
    user.cash_balance = cash
    db.flush()
    assert db.query(LedgerEntry).filter(LedgerEntry.user_id == user.id).count() == 0
    before = _max_ledger_id(db)
    ensure_opening(db, user)
    _stamp_after(db, user.id, before, when)


def _count_statements(engine, call):
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement:
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        return call(), statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def _reference_sessions() -> list[date]:
    """Six successive NYSE sessions, day 0 through day 5, ending on a Friday."""
    days = exchange_calendar.expected_session_dates(date(2026, 3, 6), date(2026, 3, 13))
    assert [day.isoformat() for day in days] == [
        "2026-03-06",
        "2026-03-09",
        "2026-03-10",
        "2026-03-11",
        "2026-03-12",
        "2026-03-13",
    ]
    assert all(exchange_calendar.is_nyse_trading_day(day) for day in days)
    assert exchange_calendar.is_nyse_trading_day(date(2026, 3, 14)) is False
    return days


def _seed_reference(db: Session, user: User, days: list[date], *, include_last_bar: bool) -> Asset:
    """Contract section 8 book: open 1000, buy 10 XYZ @ 50, sell 5 @ 55, one missing close."""
    fetched = datetime(2026, 3, 13, 12, 0, tzinfo=timezone.utc)
    _replace_opening(db, user, Decimal("1000.00"), datetime.combine(days[0], time(14, 3)))
    asset = Asset(symbol="XYZ", asset_type="stock", name="XYZ")
    db.add(asset)
    db.flush()
    _add_symbol(db, "XYZ")

    before = _max_ledger_id(db)
    append_trade(db, user.id, None, asset.id, "buy", Decimal("10"), Decimal("500.00"))
    _stamp_after(db, user.id, before, datetime.combine(days[1], time(15, 0)))

    before = _max_ledger_id(db)
    append_trade(db, user.id, None, asset.id, "sell", Decimal("5"), Decimal("275.00"))
    _stamp_after(db, user.id, before, datetime.combine(days[3], time(15, 0)))

    _bar(db, "XYZ", days[1], fetched_at=fetched, close_price=Decimal("52.00"))
    _bar(db, "XYZ", days[2], fetched_at=fetched, close_price=Decimal("54.00"))
    _bar(db, "XYZ", days[3], fetched_at=fetched, close_price=Decimal("55.00"))
    # A split-adjusted print on the gap day is not a raw close.
    _bar(
        db, "XYZ", days[4], fetched_at=fetched, adjustment="split_adjusted",
        close_price=Decimal("1.00"),
    )
    if include_last_bar:
        _bar(db, "XYZ", days[5], fetched_at=fetched, close_price=Decimal("60.00"))

    user.cash_balance = Decimal("775.00")
    db.add(Holding(
        user_id=user.id,
        asset_id=asset.id,
        quantity=Decimal("5"),
        avg_cost=Decimal("50"),
    ))
    _add_quote(db, "XYZ", Decimal("60.00"), quote_at=datetime.combine(days[5], time(17, 0)))
    db.commit()
    return asset


REFERENCE_SERIES = [
    {
        "session_date": "2026-03-06",
        "status": "available",
        "account_value": "1000.00",
        "unavailable_symbols": [],
        "twr_index": "1.000000",
        "drawdown_pct": "0.0000",
        "daily_pnl": None,
        "cumulative_pnl": "0.00",
        "benchmark_index": None,
    },
    {
        "session_date": "2026-03-09",
        "status": "available",
        "account_value": "1020.00",
        "unavailable_symbols": [],
        "twr_index": "1.020000",
        "drawdown_pct": "0.0000",
        "daily_pnl": "20.00",
        "cumulative_pnl": "20.00",
        "benchmark_index": None,
    },
    {
        "session_date": "2026-03-10",
        "status": "available",
        "account_value": "1040.00",
        "unavailable_symbols": [],
        "twr_index": "1.040000",
        "drawdown_pct": "0.0000",
        "daily_pnl": "20.00",
        "cumulative_pnl": "40.00",
        "benchmark_index": None,
    },
    {
        "session_date": "2026-03-11",
        "status": "available",
        "account_value": "1050.00",
        "unavailable_symbols": [],
        "twr_index": "1.050000",
        "drawdown_pct": "0.0000",
        "daily_pnl": "10.00",
        "cumulative_pnl": "50.00",
        "benchmark_index": None,
    },
    {
        "session_date": "2026-03-12",
        "status": "unavailable",
        "account_value": None,
        "unavailable_symbols": ["XYZ"],
        "twr_index": None,
        "drawdown_pct": None,
        "daily_pnl": None,
        "cumulative_pnl": None,
        "benchmark_index": None,
    },
    {
        "session_date": "2026-03-13",
        "status": "available",
        "account_value": "1075.00",
        "unavailable_symbols": [],
        "twr_index": "1.075000",
        "drawdown_pct": "0.0000",
        "daily_pnl": "25.00",
        "cumulative_pnl": "75.00",
        "benchmark_index": None,
    },
]


def test_performance_requires_authentication(client):
    assert client.get("/portfolio/performance", params={"range": "1y"}).status_code == 401


def test_reference_six_day_series_and_reconciliation_match(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    days = _reference_sessions()
    clock = datetime.combine(days[5], time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-reference@example.com")
    user = db_session.query(User).one()
    _seed_reference(db_session, user, days, include_last_bar=True)

    response = client.get("/portfolio/performance", headers=headers, params={"range": "1y"})
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["user"] == {"id": user.id, "email": "perf-reference@example.com"}
    assert body["range"] == "1y"
    assert body["requested_start"] == one_calendar_year_before(days[5]).isoformat()
    assert body["requested_end"] == "2026-03-13"
    assert body["inception_at"] == "2026-03-06T14:03:00Z"
    assert body["read_at"] == "2026-03-13T18:00:00Z"
    assert body["status"] == "incomplete"
    assert body["series"] == REFERENCE_SERIES
    assert body["reconciliation"] == {
        "latest_series_date": "2026-03-13",
        "latest_series_value": "1075.00",
        "current_total_account_value": "1075.00",
        "matches": True,
    }
    # Five available days and no cash_deposit/cash_withdrawal. Null is the
    # zero-flow gate, not the single-day guard and not a computed 0.0000.
    assert sum(point["status"] == "available" for point in body["series"]) >= 2
    assert body["money_weighted_return_pct"] is None


def test_reconciliation_is_null_when_today_is_not_a_trading_day(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    days = _reference_sessions()
    saturday = date(2026, 3, 14)
    assert exchange_calendar.is_nyse_trading_day(saturday) is False
    clock = datetime.combine(saturday, time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-weekend@example.com")
    user = db_session.query(User).one()
    _seed_reference(db_session, user, days, include_last_bar=True)

    body = client.get("/portfolio/performance", headers=headers, params={"range": "1y"}).json()
    assert body["requested_end"] == "2026-03-14"
    assert body["series"] == REFERENCE_SERIES
    assert body["series"][-1]["status"] == "available"
    assert body["reconciliation"] is None


def test_reconciliation_is_null_when_today_is_unavailable(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    days = _reference_sessions()
    clock = datetime.combine(days[5], time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-gap-today@example.com")
    user = db_session.query(User).one()
    _seed_reference(db_session, user, days, include_last_bar=False)

    response = client.get("/portfolio/performance", headers=headers, params={"range": "1y"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["series"][:5] == REFERENCE_SERIES[:5]
    assert body["series"][5] == {
        "session_date": "2026-03-13",
        "status": "unavailable",
        "account_value": None,
        "unavailable_symbols": ["XYZ"],
        "twr_index": None,
        "drawdown_pct": None,
        "daily_pnl": None,
        "cumulative_pnl": None,
        "benchmark_index": None,
    }
    assert body["status"] == "incomplete"
    assert body["reconciliation"] is None

    # Today's live valuation is computable. The series still must not compare against it.
    live = build_portfolio_response(db_session, user.id, user.email)
    assert live["summary"]["total_account_value"] == float(Decimal("1075.00"))


def test_reset_is_the_same_inception_boundary_as_realized_pnl(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    sessions = exchange_calendar.expected_session_dates(date(2026, 4, 6), date(2026, 4, 10))
    assert [day.isoformat() for day in sessions] == [
        "2026-04-06",
        "2026-04-07",
        "2026-04-08",
        "2026-04-09",
        "2026-04-10",
    ]
    assert all(exchange_calendar.is_nyse_trading_day(day) for day in sessions)
    opened, traded, _between, reset_day, after = sessions
    clock = datetime.combine(after, time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-reset@example.com")
    user = db_session.query(User).one()

    _replace_opening(db_session, user, Decimal("1000.00"), datetime.combine(opened, time(14, 3)))
    asset = Asset(symbol="XYZ", asset_type="stock", name="XYZ")
    db_session.add(asset)
    db_session.flush()

    before = _max_ledger_id(db_session)
    append_trade(db_session, user.id, None, asset.id, "buy", Decimal("10"), Decimal("500.00"))
    _stamp_after(db_session, user.id, before, datetime.combine(traded, time(15, 0)))

    pre_sell = Trade(
        user_id=user.id,
        asset_id=asset.id,
        side="sell",
        quantity=Decimal("4"),
        price_at_execution=Decimal("60"),
        realized_pnl=Decimal("40.00"),
        realized_pnl_pct=Decimal("20"),
        executed_at=datetime.combine(traded, time(15, 30)),
    )
    db_session.add(pre_sell)
    db_session.flush()
    before = _max_ledger_id(db_session)
    append_trade(db_session, user.id, pre_sell.id, asset.id, "sell", Decimal("4"), Decimal("240.00"))
    _stamp_after(db_session, user.id, before, datetime.combine(traded, time(15, 30)))

    # append_reset posts deltas against this live balance, which matches the ledger so far.
    user.cash_balance = Decimal("740.00")
    holding = Holding(
        user_id=user.id,
        asset_id=asset.id,
        quantity=Decimal("6"),
        avg_cost=Decimal("50"),
    )
    db_session.add(holding)
    db_session.flush()
    before = _max_ledger_id(db_session)
    append_reset(db_session, user, Decimal("100000.00"))
    _stamp_after(db_session, user.id, before, datetime.combine(reset_day, time(15, 0)))
    db_session.delete(holding)
    user.cash_balance = Decimal("100000.00")
    db_session.flush()

    before = _max_ledger_id(db_session)
    append_trade(db_session, user.id, None, asset.id, "buy", Decimal("1"), Decimal("10.00"))
    _stamp_after(db_session, user.id, before, datetime.combine(after, time(15, 0)))

    post_sell = Trade(
        user_id=user.id,
        asset_id=asset.id,
        side="sell",
        quantity=Decimal("1"),
        price_at_execution=Decimal("17"),
        realized_pnl=Decimal("7.00"),
        realized_pnl_pct=Decimal("70"),
        executed_at=datetime.combine(after, time(15, 30)),
    )
    db_session.add(post_sell)
    db_session.flush()
    before = _max_ledger_id(db_session)
    append_trade(db_session, user.id, post_sell.id, asset.id, "sell", Decimal("1"), Decimal("17.00"))
    _stamp_after(db_session, user.id, before, datetime.combine(after, time(15, 30)))
    user.cash_balance = Decimal("100007.00")
    db_session.commit()

    # Same predicate _realized_subquery uses to find the latest reset.
    latest_reset_id = db_session.execute(
        select(func.max(LedgerEntry.id)).where(
            LedgerEntry.user_id == user.id,
            LedgerEntry.event_kind == "reset",
        )
    ).scalar_one()
    reset_row = db_session.get(LedgerEntry, latest_reset_id)
    post_trade_ids = set(db_session.execute(
        select(LedgerEntry.trade_id).where(
            LedgerEntry.user_id == user.id,
            LedgerEntry.event_kind == "trade",
            LedgerEntry.id > latest_reset_id,
        )
    ).scalars())
    assert pre_sell.id not in post_trade_ids
    assert post_sell.id in post_trade_ids

    realized = db_session.execute(select(_realized_subquery(user.id))).scalar_one()
    assert Decimal(realized) == Decimal("7.00")
    portfolio = build_portfolio_response(db_session, user.id, user.email)
    assert portfolio["summary"]["total_realized_pnl"] == float(Decimal("7.00"))

    body = client.get("/portfolio/performance", headers=headers, params={"range": "1y"}).json()
    assert body["inception_at"] == "2026-04-09T15:00:00Z"
    assert body["inception_at"] == reset_row.created_at.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    dates = [point["session_date"] for point in body["series"]]
    assert dates == ["2026-04-09", "2026-04-10"]
    assert opened.isoformat() not in dates
    assert traded.isoformat() not in dates
    assert body["series"][0]["status"] == "available"
    assert body["series"][0]["account_value"] == "100000.00"
    assert body["series"][0]["twr_index"] == "1.000000"
    assert body["series"][0]["drawdown_pct"] == "0.0000"
    assert body["series"][0]["daily_pnl"] is None
    assert body["series"][0]["cumulative_pnl"] == "0.00"
    assert body["series"][0]["benchmark_index"] is None
    assert body["series"][0]["unavailable_symbols"] == []
    assert body["series"][1] == {
        "session_date": "2026-04-10",
        "status": "available",
        "account_value": "100007.00",
        "unavailable_symbols": [],
        "twr_index": "1.000070",
        "drawdown_pct": "0.0000",
        "daily_pnl": "7.00",
        "cumulative_pnl": "7.00",
        "benchmark_index": None,
    }
    assert body["status"] == "complete"
    assert body["reconciliation"]["matches"] is True
    assert body["reconciliation"]["current_total_account_value"] == "100007.00"


def test_ambiguous_raw_providers_make_the_day_unavailable(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    sessions = exchange_calendar.expected_session_dates(date(2026, 5, 4), date(2026, 5, 5))
    assert len(sessions) == 2
    assert all(exchange_calendar.is_nyse_trading_day(day) for day in sessions)
    opened, priced = sessions
    clock = datetime.combine(priced, time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-ambiguous@example.com")
    user = db_session.query(User).one()
    fetched = datetime(2026, 5, 5, 12, 0, tzinfo=timezone.utc)

    _replace_opening(db_session, user, Decimal("1000.00"), datetime.combine(opened, time(14, 3)))
    asset = Asset(symbol="XYZ", asset_type="stock", name="XYZ")
    db_session.add(asset)
    db_session.flush()
    _add_symbol(db_session, "XYZ")
    before = _max_ledger_id(db_session)
    append_trade(db_session, user.id, None, asset.id, "buy", Decimal("10"), Decimal("500.00"))
    _stamp_after(db_session, user.id, before, datetime.combine(priced, time(15, 0)))
    _bar(db_session, "XYZ", priced, provider="alpha", fetched_at=fetched, close_price=Decimal("52.00"))
    _bar(db_session, "XYZ", priced, provider="bravo", fetched_at=fetched, close_price=Decimal("99.00"))
    db_session.commit()

    body = client.get("/portfolio/performance", headers=headers, params={"range": "1y"}).json()
    assert [point["session_date"] for point in body["series"]] == [
        opened.isoformat(),
        priced.isoformat(),
    ]
    assert body["series"][0]["status"] == "available"
    assert body["series"][0]["account_value"] == "1000.00"
    assert body["series"][0]["twr_index"] == "1.000000"
    assert body["series"][0]["drawdown_pct"] == "0.0000"
    assert body["series"][0]["daily_pnl"] is None
    assert body["series"][0]["cumulative_pnl"] == "0.00"
    assert body["series"][0]["benchmark_index"] is None
    assert body["series"][1] == {
        "session_date": priced.isoformat(),
        "status": "unavailable",
        "account_value": None,
        "unavailable_symbols": ["XYZ"],
        "twr_index": None,
        "drawdown_pct": None,
        "daily_pnl": None,
        "cumulative_pnl": None,
        "benchmark_index": None,
    }
    assert body["status"] == "incomplete"
    assert "1020.00" not in {point["account_value"] for point in body["series"]}
    assert "1490.00" not in {point["account_value"] for point in body["series"]}
    assert body["reconciliation"] is None


def test_deposit_and_withdrawal_are_excluded_from_the_return_ratio(client, auth_headers, db_session, monkeypatch):
    """Contract section 5's extension of the reference scenario (days 6-9).

    A naive, un-excluded ratio would show day 6's twr_index jump to roughly
    1.175 purely from depositing cash. The correct figure stays flat at
    1.075000 on every one of these four days, since nothing but cash moved.
    """
    _forbid_providers(monkeypatch)
    days = exchange_calendar.expected_session_dates(date(2026, 3, 6), date(2026, 3, 20))
    assert [day.isoformat() for day in days[6:10]] == [
        "2026-03-16", "2026-03-17", "2026-03-18", "2026-03-19",
    ]
    day6, day7, day8, day9 = days[6:10]
    clock = datetime.combine(day9, time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-flows@example.com")
    user = db_session.query(User).one()
    _seed_reference(db_session, user, days[:6], include_last_bar=True)
    fetched = datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc)

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "deposit", Decimal("100.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(day6, time(10, 0)))
    assert user.cash_balance == Decimal("875.00")

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "withdrawal", Decimal("50.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(day7, time(10, 0)))
    assert user.cash_balance == Decimal("825.00")

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "deposit", Decimal("20.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(day8, time(10, 0)))
    assert user.cash_balance == Decimal("845.00")

    _bar(db_session, "XYZ", day6, fetched_at=fetched, close_price=Decimal("60.00"))
    _bar(db_session, "XYZ", day7, fetched_at=fetched, close_price=Decimal("60.00"))
    # Day 8 has no raw close at all: the gap the $20 deposit lands on.
    _bar(db_session, "XYZ", day9, fetched_at=fetched, close_price=Decimal("60.00"))
    db_session.commit()

    body = client.get("/portfolio/performance", headers=headers, params={"range": "1y"}).json()
    by_date = {point["session_date"]: point for point in body["series"]}

    assert by_date[day6.isoformat()] == {
        "session_date": day6.isoformat(),
        "status": "available",
        "account_value": "1175.00",
        "unavailable_symbols": [],
        "twr_index": "1.075000",
        "drawdown_pct": "0.0000",
        "daily_pnl": "0.00",
        "cumulative_pnl": "75.00",
        "benchmark_index": None,
    }
    # Proves the exclusion actually fired, not merely that some number came out.
    assert by_date[day6.isoformat()]["twr_index"] != "1.175000"

    assert by_date[day7.isoformat()] == {
        "session_date": day7.isoformat(),
        "status": "available",
        "account_value": "1125.00",
        "unavailable_symbols": [],
        "twr_index": "1.075000",
        "drawdown_pct": "4.2553",
        "daily_pnl": "0.00",
        "cumulative_pnl": "75.00",
        "benchmark_index": None,
    }

    assert by_date[day8.isoformat()] == {
        "session_date": day8.isoformat(),
        "status": "unavailable",
        "account_value": None,
        "unavailable_symbols": ["XYZ"],
        "twr_index": None,
        "drawdown_pct": None,
        "daily_pnl": None,
        "cumulative_pnl": None,
        "benchmark_index": None,
    }

    assert by_date[day9.isoformat()] == {
        "session_date": day9.isoformat(),
        "status": "available",
        "account_value": "1145.00",
        "unavailable_symbols": [],
        "twr_index": "1.075000",
        "drawdown_pct": "2.5532",
        "daily_pnl": "0.00",
        "cumulative_pnl": "75.00",
        "benchmark_index": None,
    }

    # Same excluded-flow logic, two fields: flat dollars iff the index did not move.
    # Day 1 is trade-driven (index moves). Days 6, 7, and 9 are flow-only (index flat).
    # Day 9's prior available day is day 7; the day-8 gap is not a base.
    checked = (
        (days[1].isoformat(), days[0].isoformat()),
        (day6.isoformat(), days[5].isoformat()),
        (day7.isoformat(), day6.isoformat()),
        (day9.isoformat(), day7.isoformat()),
    )
    for session_date, prior_date in checked:
        point = by_date[session_date]
        prior = by_date[prior_date]
        assert prior["status"] == "available"
        pnl_is_flat = point["daily_pnl"] == "0.00"
        index_is_unchanged = point["twr_index"] == prior["twr_index"]
        assert pnl_is_flat is index_is_unchanged, (
            session_date,
            point["daily_pnl"],
            point["twr_index"],
            prior["twr_index"],
        )

    # Day 9 has two gaps (day 4, day 8) and cash flows since the base day.
    # cumulative_pnl equals the telescoping sum of daily_pnl over days that
    # were actually valued. A null daily_pnl (a gap) contributes nothing.
    base_index = next(
        index for index, point in enumerate(body["series"]) if point["status"] == "available"
    )
    through = day9.isoformat()
    window = [
        point for point in body["series"][base_index + 1:]
        if point["session_date"] <= through
    ]
    assert any(point["daily_pnl"] is None for point in window)
    assert any(point["daily_pnl"] == "0.00" for point in window)
    summed = sum(
        (Decimal(point["daily_pnl"]) for point in window if point["daily_pnl"] is not None),
        Decimal("0.00"),
    )
    assert Decimal(by_date[through]["cumulative_pnl"]) == summed

    assert body["status"] == "incomplete"
    assert body["reconciliation"]["matches"] is True
    assert body["reconciliation"]["current_total_account_value"] == "1145.00"
    # 75 / (13220/13) * 100 = 19500/2644 = 7.375189... → "7.3752".
    assert body["money_weighted_return_pct"] == "7.3752"


def test_money_weighted_return_is_null_on_a_single_available_day(client, auth_headers, db_session, monkeypatch):
    """base_date == last_available_date, so T would be 0.

    The same-day deposit is in the books (account value is 1100.00, not the
    1000.00 opening). Null is the one-day guard, not the zero-flow gate.
    """
    _forbid_providers(monkeypatch)
    sessions = exchange_calendar.expected_session_dates(date(2026, 5, 4), date(2026, 5, 4))
    assert sessions == [date(2026, 5, 4)]
    session = sessions[0]
    clock = datetime.combine(session, time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-mwr-one-day@example.com")
    user = db_session.query(User).one()

    _replace_opening(db_session, user, Decimal("1000.00"), datetime.combine(session, time(14, 3)))
    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "deposit", Decimal("100.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(session, time(15, 0)))
    db_session.commit()

    body = client.get("/portfolio/performance", headers=headers, params={"range": "1y"}).json()
    assert [point["session_date"] for point in body["series"]] == [session.isoformat()]
    assert body["series"][0]["status"] == "available"
    assert body["series"][0]["account_value"] == "1100.00"
    assert body["money_weighted_return_pct"] is None


def test_spy_benchmark_index_is_independent_of_the_account_chain(client, auth_headers, db_session, monkeypatch):
    """Contract section 13. SPY closes over the same ten sessions as the flow fixture.

    The account still gaps on day 4 (no raw XYZ close) and is fully valued on
    day 7. SPY is known on day 4 and missing on days 7 and 8. Day 9's index is
    the day-6 chain continued across that SPY gap: 1.050000 * 424/420 = 1.060000.
    A reset on the resume day would be 1.000000.
    """
    _forbid_providers(monkeypatch)
    days = exchange_calendar.expected_session_dates(date(2026, 3, 6), date(2026, 3, 20))
    assert days[:6] == _reference_sessions()
    assert [day.isoformat() for day in days[6:10]] == [
        "2026-03-16", "2026-03-17", "2026-03-18", "2026-03-19",
    ]
    window = days[:10]
    day6, day7, day8, day9 = window[6:10]
    clock = datetime.combine(day9, time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-benchmark@example.com")
    user = db_session.query(User).one()
    _seed_reference(db_session, user, window[:6], include_last_bar=True)
    fetched = datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc)

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "deposit", Decimal("100.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(day6, time(10, 0)))

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "withdrawal", Decimal("50.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(day7, time(10, 0)))

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "deposit", Decimal("20.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(day8, time(10, 0)))

    _bar(db_session, "XYZ", day6, fetched_at=fetched, close_price=Decimal("60.00"))
    _bar(db_session, "XYZ", day7, fetched_at=fetched, close_price=Decimal("60.00"))
    _bar(db_session, "XYZ", day9, fetched_at=fetched, close_price=Decimal("60.00"))

    # Section 13 table. Days 7 and 8 have no SPY close at all.
    spy_closes = [
        Decimal("400.00"),
        Decimal("404.00"),
        Decimal("408.00"),
        Decimal("404.00"),
        Decimal("412.00"),
        Decimal("416.00"),
        Decimal("420.00"),
        None,
        None,
        Decimal("424.00"),
    ]
    _add_symbol(db_session, "SPY")
    for session_day, close_price in zip(window, spy_closes, strict=True):
        if close_price is None:
            continue
        _bar(db_session, "SPY", session_day, fetched_at=fetched, close_price=close_price)
    db_session.commit()

    body = client.get("/portfolio/performance", headers=headers, params={"range": "1y"}).json()
    assert [point["session_date"] for point in body["series"]] == [day.isoformat() for day in window]
    assert [point["benchmark_index"] for point in body["series"]] == [
        "1.000000",
        "1.010000",
        "1.020000",
        "1.010000",
        "1.030000",
        "1.040000",
        "1.050000",
        None,
        None,
        "1.060000",
    ]

    # Day 4 is an account gap. SPY's own chain still has a value.
    assert body["series"][4] == {
        "session_date": window[4].isoformat(),
        "status": "unavailable",
        "account_value": None,
        "unavailable_symbols": ["XYZ"],
        "twr_index": None,
        "drawdown_pct": None,
        "daily_pnl": None,
        "cumulative_pnl": None,
        "benchmark_index": "1.030000",
    }

    # Day 7 is a full account day. SPY itself is the gap.
    by_date = {point["session_date"]: point for point in body["series"]}
    assert by_date[day7.isoformat()] == {
        "session_date": day7.isoformat(),
        "status": "available",
        "account_value": "1125.00",
        "unavailable_symbols": [],
        "twr_index": "1.075000",
        "drawdown_pct": "4.2553",
        "daily_pnl": "0.00",
        "cumulative_pnl": "75.00",
        "benchmark_index": None,
    }

    # Day 9 chains from day 6 (420.00, "1.050000") across the two null days.
    assert by_date[day6.isoformat()]["benchmark_index"] == "1.050000"
    assert by_date[day8.isoformat()]["benchmark_index"] is None
    assert by_date[day9.isoformat()]["benchmark_index"] == "1.060000"
    assert by_date[day9.isoformat()]["benchmark_index"] != "1.000000"


def test_drawdown_peak_survives_a_gap_day(client, auth_headers, db_session, monkeypatch):
    """The day-8 gap keeps the day-6 peak. It does not clear it.

    Day 9 is 1145.00, below day 6's 1175.00 and above day 7's 1125.00.
    "2.5532" is (1175.00 - 1145.00) / 1175.00 * 100. A gap that reset the
    peak would make day 9 a new high, and the figure would be "0.0000".
    """
    _forbid_providers(monkeypatch)
    days = exchange_calendar.expected_session_dates(date(2026, 3, 6), date(2026, 3, 20))
    day6, day7, day8, day9 = days[6:10]
    clock = datetime.combine(day9, time(18, 0))
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-drawdown-gap@example.com")
    user = db_session.query(User).one()
    _seed_reference(db_session, user, days[:6], include_last_bar=True)
    fetched = datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc)

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "deposit", Decimal("100.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(day6, time(10, 0)))

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "withdrawal", Decimal("50.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(day7, time(10, 0)))

    before = _max_ledger_id(db_session)
    post_movement(db_session, user, "deposit", Decimal("20.00"), None)
    _stamp_after(db_session, user.id, before, datetime.combine(day8, time(10, 0)))

    _bar(db_session, "XYZ", day6, fetched_at=fetched, close_price=Decimal("60.00"))
    _bar(db_session, "XYZ", day7, fetched_at=fetched, close_price=Decimal("60.00"))
    _bar(db_session, "XYZ", day9, fetched_at=fetched, close_price=Decimal("60.00"))
    db_session.commit()

    body = client.get("/portfolio/performance", headers=headers, params={"range": "1y"}).json()
    by_date = {point["session_date"]: point for point in body["series"]}
    peak_day = by_date[day6.isoformat()]
    before_gap = by_date[day7.isoformat()]
    gap = by_date[day8.isoformat()]
    after_gap = by_date[day9.isoformat()]

    assert peak_day["account_value"] == "1175.00"
    assert peak_day["drawdown_pct"] == "0.0000"
    assert peak_day["daily_pnl"] == "0.00"
    assert peak_day["cumulative_pnl"] == "75.00"
    assert before_gap["account_value"] == "1125.00"
    assert before_gap["drawdown_pct"] == "4.2553"
    assert before_gap["daily_pnl"] == "0.00"
    assert before_gap["cumulative_pnl"] == "75.00"
    assert gap["status"] == "unavailable"
    assert gap["account_value"] is None
    assert gap["drawdown_pct"] is None
    assert gap["daily_pnl"] is None
    assert gap["cumulative_pnl"] is None
    assert after_gap["account_value"] == "1145.00"
    assert after_gap["drawdown_pct"] == "2.5532"
    assert after_gap["drawdown_pct"] != "0.0000"
    assert after_gap["daily_pnl"] == "0.00"
    assert after_gap["cumulative_pnl"] == "75.00"


def test_range_must_be_one_or_two_years(client, auth_headers, db_session):
    headers = auth_headers("perf-range@example.com")
    user = db_session.query(User).one()
    detail = "range must be 1y or 2y."
    for token in ("6mo", "3y", "1Y", "", "1m", "3m", "6m", "all"):
        response = client.get("/portfolio/performance", headers=headers, params={"range": token})
        assert response.status_code == 422, token
        assert response.json()["detail"] == detail
        with pytest.raises(HTTPException) as caught:
            build_performance_response(db_session, user.id, user.email, token)
        assert caught.value.status_code == 422
        assert caught.value.detail == detail


def test_query_count_does_not_grow_with_trading_days(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    end = date(2026, 11, 5)
    assert exchange_calendar.is_nyse_trading_day(end) is True
    clock = datetime(2026, 11, 5, 18, 0)
    _pin_clock(monkeypatch, clock)
    headers = auth_headers("perf-queries@example.com")
    user = db_session.query(User).one()

    window_start = two_calendar_years_before(end)
    sessions = exchange_calendar.expected_session_dates(window_start, end)
    one_year = exchange_calendar.expected_session_dates(one_calendar_year_before(end), end)
    assert len(sessions) > len(one_year) > 200

    _replace_opening(db_session, user, Decimal("1000.00"), datetime.combine(sessions[0], time(14, 3)))
    asset = Asset(symbol="HELD", asset_type="stock", name="HELD")
    db_session.add(asset)
    db_session.flush()
    _add_symbol(db_session, "HELD")
    before = _max_ledger_id(db_session)
    append_trade(db_session, user.id, None, asset.id, "buy", Decimal("1"), Decimal("10.00"))
    _stamp_after(db_session, user.id, before, datetime.combine(sessions[0], time(15, 0)))
    fetched = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)
    for session_day in sessions:
        _bar(db_session, "HELD", session_day, fetched_at=fetched, close_price=Decimal("10.00"))
    # One SPY bar inside both the 1y and 2y windows, so the benchmark query
    # returns a row and the chain's base case actually runs.
    _add_symbol(db_session, "SPY")
    _bar(db_session, "SPY", end, fetched_at=fetched, close_price=Decimal("400.00"))
    db_session.commit()

    engine = db_session.get_bind()

    def _reads(token):
        response, statements = _count_statements(
            engine,
            lambda: client.get("/portfolio/performance", headers=headers, params={"range": token}),
        )
        assert response.status_code == 200, response.text
        return response.json(), statements

    one_body, one_statements = _reads("1y")
    two_body, two_statements = _reads("2y")
    assert one_body["status"] == "complete"
    assert two_body["status"] == "complete"
    assert len(two_body["series"]) > len(one_body["series"]) > 200

    def _mentions(statements, token):
        return [statement for statement in statements if token in statement.lower()]

    one_bars = _mentions(one_statements, "market_bars_daily")
    two_bars = _mentions(two_statements, "market_bars_daily")
    one_ledger = _mentions(one_statements, "ledger_entries")
    two_ledger = _mentions(two_statements, "ledger_entries")
    # Held-asset closes, plus one SPY query for the whole window. Neither grows
    # with the number of trading days.
    assert len(one_bars) == 2
    assert len(two_bars) == 2
    assert one_body["series"][0]["benchmark_index"] is None
    assert two_body["series"][0]["benchmark_index"] is None
    assert one_body["series"][-1]["session_date"] == end.isoformat()
    assert one_body["series"][-1]["benchmark_index"] == "1.000000"
    assert two_body["series"][-1]["benchmark_index"] == "1.000000"
    assert len(one_ledger) == len(two_ledger)
    assert len(one_ledger) < len(one_year)
    assert len(one_statements) == len(two_statements)
