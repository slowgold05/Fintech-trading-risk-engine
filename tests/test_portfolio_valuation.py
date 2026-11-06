"""GET /portfolio/ uses one cached snapshot and does not call a price provider."""

from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from tempfile import TemporaryDirectory

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.security import hash_password
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.lot import Lot
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import User
from app.services.portfolio_valuation import build_portfolio_response


def _forbid_providers(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("provider called")

    monkeypatch.setattr("app.services.price_service.get_live_price", boom)
    monkeypatch.setattr("app.services.price_service.get_stock_quote", boom)
    monkeypatch.setattr("requests.get", boom)


def _observed():
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)


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
    observed = quote_at if quote_at is not None else _observed()
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


def _add_position(db, user, symbol, asset_type, quantity, avg_cost):
    asset = Asset(symbol=symbol, asset_type=asset_type, name=symbol)
    db.add(asset)
    db.flush()
    db.add(Holding(
        user_id=user.id,
        asset_id=asset.id,
        quantity=quantity,
        avg_cost=avg_cost,
    ))
    return asset


def _money(body):
    clone = {
        "user": body["user"],
        "valuation_status": body["valuation_status"],
        "unavailable_symbols": body["unavailable_symbols"],
        "positions": body["positions"],
        "summary": body["summary"],
    }
    return clone


def _count_quote_queries(engine, call):
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement and "market_quote_cache" in statement.lower():
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        return call(), statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def test_portfolio_requires_authentication(client):
    assert client.get("/portfolio/").status_code == 401


def test_missing_user_is_not_a_missing_price(db_session):
    with pytest.raises(HTTPException) as caught:
        build_portfolio_response(db_session, 999999, "missing@example.com")
    assert caught.value.status_code == 404


def test_complete_two_position_marks_and_empty_book(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("priced@example.com")
    user = db_session.query(User).one()
    user.cash_balance = Decimal("1000.00")
    apple = _add_position(db_session, user, "AAPL", "stock", Decimal("2"), Decimal("10"))
    _add_position(db_session, user, "MSFT", "stock", Decimal("1.5"), Decimal("40"))
    _add_position(db_session, user, "FLAT", "stock", Decimal("0"), Decimal("10"))
    _add_symbol(db_session, "AAPL")
    _add_symbol(db_session, "MSFT")
    _add_quote(db_session, "AAPL", Decimal("100.25"))
    _add_quote(db_session, "MSFT", Decimal("10.10"))
    db_session.add(Order(
        user_id=user.id,
        asset_id=apple.id,
        side="buy",
        order_type="limit",
        quantity=Decimal("2"),
        remaining_quantity=Decimal("2"),
        limit_price=Decimal("10"),
        status="open",
    ))
    db_session.add(Trade(
        user_id=user.id,
        asset_id=apple.id,
        side="sell",
        quantity=Decimal("1"),
        price_at_execution=Decimal("12"),
        realized_pnl=Decimal("12.34"),
    ))
    db_session.commit()

    engine = db_session.get_bind()
    response, statements = _count_quote_queries(
        engine, lambda: client.get("/portfolio/", headers=headers)
    )
    assert response.status_code == 200
    assert len(statements) == 1
    body = response.json()
    assert body["valuation_status"] == "complete"
    assert body["unavailable_symbols"] == []
    assert body["snapshot_read_at"].endswith("Z")
    assert [position["symbol"] for position in body["positions"]] == ["AAPL", "MSFT"]

    apple_position, microsoft = body["positions"]
    assert apple_position["quantity"] == 2
    assert apple_position["current_price"] == float(Decimal("100.25"))
    assert apple_position["position_value"] == float(Decimal("200.50"))
    assert apple_position["cost_basis"] == float(Decimal("20.00"))
    assert apple_position["unrealized_pnl"] == float(Decimal("180.50"))
    assert apple_position["price_status"] == "available"
    assert apple_position["unavailable_reason"] is None
    assert apple_position["source"] == "yahoo"
    assert microsoft["position_value"] == float(Decimal("15.15"))
    assert microsoft["cost_basis"] == float(Decimal("60.00"))
    assert microsoft["unrealized_pnl"] == float(Decimal("-44.85"))

    summary = body["summary"]
    assert summary["cash_balance"] == float(Decimal("1000.00"))
    assert summary["buying_power"] == float(Decimal("980.00"))
    assert summary["total_portfolio_value"] == float(Decimal("215.65"))
    assert summary["total_cost_basis"] == float(Decimal("80.00"))
    assert summary["total_unrealized_pnl"] == float(Decimal("135.65"))
    assert summary["total_unrealized_pnl_pct"] == float(Decimal("169.56"))
    assert summary["total_realized_pnl"] == float(Decimal("12.34"))
    assert summary["total_pnl"] == float(Decimal("147.99"))
    assert summary["total_account_value"] == float(Decimal("1215.65"))

    for symbol, quantity, avg_cost in (("GONE", Decimal("1"), Decimal("3")), ("ZZZ", Decimal("4"), Decimal("8"))):
        _add_symbol(db_session, symbol)
        _add_quote(db_session, symbol, Decimal("20"))
        _add_position(db_session, user, symbol, "stock", quantity, avg_cost)
    db_session.commit()
    _again, again_statements = _count_quote_queries(
        engine, lambda: client.get("/portfolio/", headers=headers)
    )
    assert _again.status_code == 200
    assert len(again_statements) == 1
    assert len(_again.json()["positions"]) == 4

    empty_headers = auth_headers("empty@example.com")
    empty = client.get("/portfolio/", headers=empty_headers)
    assert empty.status_code == 200
    empty_body = empty.json()
    assert empty_body["valuation_status"] == "complete"
    assert empty_body["positions"] == []
    assert empty_body["summary"]["total_portfolio_value"] == 0
    assert empty_body["summary"]["total_unrealized_pnl"] == 0
    assert empty_body["summary"]["total_account_value"] == empty_body["summary"]["cash_balance"]
    assert empty_body["summary"]["cash_balance"] == float(Decimal("100000.00"))


def test_missing_price_is_200_compatibility_change(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("mixed@example.com")
    user = db_session.query(User).filter(User.email == "mixed@example.com").one()
    user.cash_balance = Decimal("5000.00")
    apple = _add_position(db_session, user, "AAPL", "stock", Decimal("2"), Decimal("10"))
    _add_position(db_session, user, "MISS", "stock", Decimal("1"), Decimal("5"))
    _add_position(db_session, user, "BAD", "stock", Decimal("1"), Decimal("5"))
    _add_position(db_session, user, "NEG", "stock", Decimal("1"), Decimal("5"))
    _add_position(db_session, user, "OLD", "stock", Decimal("1"), Decimal("5"))
    _add_position(db_session, user, "BTC", "crypto", Decimal("1"), Decimal("5"))
    _add_position(db_session, user, "ZERO", "stock", Decimal("0"), Decimal("9"))
    for symbol in ("AAPL", "BAD", "NEG", "OLD", "BTC"):
        _add_symbol(db_session, symbol)
    fresh = _observed()
    stale_at = fresh - timedelta(days=30)
    fetched = fresh - timedelta(days=1)
    _add_quote(db_session, "AAPL", Decimal("100.25"), quote_at=fresh, fetched_at=fetched)
    _add_quote(db_session, "BAD", Decimal("0"), quote_at=fresh, fetched_at=fetched)
    _add_quote(db_session, "NEG", Decimal("-5"), quote_at=fresh, fetched_at=fetched)
    _add_quote(db_session, "OLD", Decimal("10"), quote_at=stale_at, fetched_at=fetched)
    _add_quote(db_session, "BTC", Decimal("100"), quote_at=fresh, fetched_at=fetched)
    db_session.add(Order(
        user_id=user.id,
        asset_id=apple.id,
        side="buy",
        order_type="limit",
        quantity=Decimal("2"),
        remaining_quantity=Decimal("2"),
        limit_price=Decimal("10"),
        status="open",
    ))
    db_session.add(Trade(
        user_id=user.id,
        asset_id=apple.id,
        side="sell",
        quantity=Decimal("1"),
        price_at_execution=Decimal("11"),
        realized_pnl=Decimal("12.34"),
    ))
    db_session.commit()

    response = client.get("/portfolio/", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["valuation_status"] == "incomplete"
    positions = {position["symbol"]: position for position in body["positions"]}
    assert list(positions) == ["AAPL", "BAD", "BTC", "MISS", "NEG", "OLD"]
    assert "ZERO" not in positions
    assert positions["AAPL"]["price_status"] == "available"
    assert positions["AAPL"]["current_price"] == float(Decimal("100.25"))
    assert positions["AAPL"]["position_value"] == float(Decimal("200.50"))

    missing = positions["MISS"]
    assert missing["price_status"] == "unavailable"
    assert missing["unavailable_reason"] == "missing"
    assert missing["quantity"] == 1
    assert missing["cost_basis"] == float(Decimal("5.00"))
    assert missing["current_price"] is None
    assert missing["position_value"] is None
    assert missing["unrealized_pnl"] is None
    assert missing["unrealized_pnl_pct"] is None
    assert missing["source"] is None
    assert missing["quote_at"] is None
    assert missing["fetched_at"] is None

    for symbol, reason in (("BAD", "invalid"), ("NEG", "invalid"), ("OLD", "stale"), ("BTC", "unsupported_asset")):
        position = positions[symbol]
        assert position["price_status"] == "unavailable"
        assert position["unavailable_reason"] == reason
        assert position["current_price"] is None
        assert position["position_value"] is None
        assert position["unrealized_pnl"] is None
        assert position["cost_basis"] == float(Decimal("5.00"))
        assert position["source"] == "yahoo"
        assert position["quote_at"] is not None
        assert position["fetched_at"] is not None

    assert positions["BTC"]["quote_at"] != body["snapshot_read_at"]
    assert body["unavailable_symbols"] == ["BAD", "BTC", "MISS", "NEG", "OLD"]
    summary = body["summary"]
    assert summary["cash_balance"] == float(Decimal("5000.00"))
    assert summary["buying_power"] == float(Decimal("4980.00"))
    assert summary["total_cost_basis"] == float(Decimal("45.00"))
    assert summary["total_realized_pnl"] == float(Decimal("12.34"))
    for key in (
        "total_portfolio_value",
        "total_account_value",
        "total_unrealized_pnl",
        "total_unrealized_pnl_pct",
        "total_pnl",
    ):
        assert key in summary
        assert summary[key] is None


def _parse_snapshot(body):
    return datetime.fromisoformat(body["snapshot_read_at"].replace("Z", "+00:00")).replace(tzinfo=None)


def _set_quote_time(db, symbol, quote_at):
    quote = db.query(MarketQuoteCache).filter(MarketQuoteCache.symbol == symbol).one()
    quote.quote_at = quote_at
    db.commit()
    return quote


def test_freshness_boundary_future_quotes_and_other_sources(client, auth_headers, db_session):
    headers = auth_headers("fresh@example.com")
    user = db_session.query(User).one()
    _add_position(db_session, user, "AAPL", "stock", Decimal("1"), Decimal("10"))
    _add_symbol(db_session, "AAPL", tier="daily")
    _add_quote(db_session, "AAPL", Decimal("20"))
    db_session.commit()

    first = client.get("/portfolio/", headers=headers)
    assert first.status_code == 200
    snapshot = _parse_snapshot(first.json())
    _set_quote_time(db_session, "AAPL", datetime.combine(snapshot.date() - timedelta(days=7), time(12, 0)))
    cached = client.get("/portfolio/", headers=headers).json()
    assert cached["valuation_status"] == "complete"
    assert cached["positions"][0]["price_status"] == "available"
    assert cached["positions"][0]["source"] == "yahoo"

    _set_quote_time(db_session, "AAPL", datetime.combine(snapshot.date() - timedelta(days=8), time(12, 0)))
    stale = client.get("/portfolio/", headers=headers).json()
    assert stale["valuation_status"] == "incomplete"
    assert stale["positions"][0]["price_status"] == "unavailable"
    assert stale["positions"][0]["unavailable_reason"] == "stale"
    assert stale["positions"][0]["quote_at"].startswith((snapshot.date() - timedelta(days=8)).isoformat())

    future = snapshot + timedelta(days=1)
    _set_quote_time(db_session, "AAPL", future)
    future_body = client.get("/portfolio/", headers=headers).json()
    assert future_body["positions"][0]["unavailable_reason"] == "invalid"
    assert future_body["positions"][0]["quote_at"].startswith(future.date().isoformat())
    assert not future_body["positions"][0]["quote_at"].startswith(future_body["snapshot_read_at"][:10])

    _set_quote_time(db_session, "AAPL", datetime(2099, 1, 1, 15, 0))
    distant = client.get("/portfolio/", headers=headers).json()
    assert distant["positions"][0]["unavailable_reason"] == "invalid"
    assert distant["positions"][0]["quote_at"].startswith("2099-01-01")
    assert distant["positions"][0]["current_price"] is None

    quote = db_session.query(MarketQuoteCache).one()
    quote.source = "broker"
    quote.quote_at = snapshot - timedelta(hours=2)
    db_session.commit()
    delayed = client.get("/portfolio/", headers=headers).json()
    assert delayed["positions"][0]["price_status"] == "available"
    assert delayed["positions"][0]["source"] == "broker"
    assert delayed["valuation_status"] == "complete"

    quote = db_session.query(MarketQuoteCache).one()
    quote.quote_at = snapshot - timedelta(days=8)
    db_session.commit()
    elapsed = client.get("/portfolio/", headers=headers).json()
    assert elapsed["positions"][0]["unavailable_reason"] == "stale"
    assert elapsed["positions"][0]["source"] == "broker"

    quote = db_session.query(MarketQuoteCache).one()
    quote.quote_at = None
    quote.fetched_at = snapshot - timedelta(minutes=5)
    quote.source = "manual"
    db_session.commit()
    undated = client.get("/portfolio/", headers=headers).json()["positions"][0]
    assert undated["unavailable_reason"] == "stale"
    assert undated["source"] == "manual"
    assert undated["quote_at"] is None
    assert undated["fetched_at"] is not None
    assert undated["current_price"] is None


def test_same_second_observed_quote_stays_available(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    clock = datetime(2026, 11, 5, 18, 27, 2, 258005)
    earlier = datetime(2026, 11, 5, 18, 27, 2, 129002)
    later_fraction = datetime(2026, 11, 5, 18, 27, 2, 258006)
    monkeypatch.setattr("app.core.read_snapshot._python_utc_now", lambda: clock)

    headers = auth_headers("fraction@example.com")
    user = db_session.query(User).one()
    user.cash_balance = Decimal("1000.00")
    _add_position(db_session, user, "AAPL", "stock", Decimal("2"), Decimal("10"))
    _add_symbol(db_session, "AAPL")
    _add_quote(
        db_session, "AAPL", Decimal("100.25"), source="yahoo",
        quote_at=earlier, fetched_at=earlier,
    )
    db_session.commit()

    body = client.get("/portfolio/", headers=headers).json()
    assert body["snapshot_read_at"] == "2026-11-05T18:27:02.258005Z"
    assert body["valuation_status"] == "complete"
    position = body["positions"][0]
    assert position["price_status"] == "available"
    assert position["current_price"] == float(Decimal("100.25"))
    assert position["position_value"] == float(Decimal("200.50"))
    assert position["quote_at"] == "2026-11-05T18:27:02.129002Z"
    assert position["fetched_at"] == "2026-11-05T18:27:02.129002Z"

    _set_quote_time(db_session, "AAPL", later_fraction)
    rejected = client.get("/portfolio/", headers=headers).json()
    assert rejected["snapshot_read_at"] == "2026-11-05T18:27:02.258005Z"
    assert rejected["valuation_status"] == "incomplete"
    rejected_position = rejected["positions"][0]
    assert rejected_position["price_status"] == "unavailable"
    assert rejected_position["unavailable_reason"] == "invalid"
    assert rejected_position["current_price"] is None
    assert rejected_position["quote_at"] == "2026-11-05T18:27:02.258006Z"
    assert rejected["summary"]["total_portfolio_value"] is None

    _set_quote_time(db_session, "AAPL", clock)
    equal = client.get("/portfolio/", headers=headers).json()
    assert equal["valuation_status"] == "complete"
    assert equal["positions"][0]["price_status"] == "available"
    assert equal["positions"][0]["current_price"] == float(Decimal("100.25"))
    assert equal["positions"][0]["quote_at"] == "2026-11-05T18:27:02.258005Z"


def test_buying_power_quantizes_each_open_buy(client, auth_headers, db_session):
    headers = auth_headers("reserved@example.com")
    user = db_session.query(User).one()
    user.cash_balance = Decimal("1000.00")
    asset = _add_position(db_session, user, "AAPL", "stock", Decimal("0"), Decimal("1"))
    db_session.add(Order(
        user_id=user.id,
        asset_id=asset.id,
        side="buy",
        order_type="limit",
        quantity=Decimal("1.005"),
        remaining_quantity=Decimal("1.005"),
        limit_price=Decimal("1"),
        status="open",
    ))
    db_session.commit()

    summary = client.get("/portfolio/", headers=headers).json()["summary"]
    assert summary["buying_power"] == float(Decimal("998.99"))
    assert summary["total_account_value"] == float(Decimal("1000.00"))


def test_accounts_do_not_share_holdings(client, auth_headers, db_session):
    first_headers = auth_headers("one@example.com")
    second_headers = auth_headers("two@example.com")
    first, second = db_session.query(User).order_by(User.id).all()
    _add_position(db_session, first, "AAPL", "stock", Decimal("2"), Decimal("10"))
    _add_position(db_session, second, "MSFT", "stock", Decimal("3"), Decimal("8"))
    _add_symbol(db_session, "AAPL")
    _add_symbol(db_session, "MSFT")
    _add_quote(db_session, "AAPL", Decimal("11"))
    _add_quote(db_session, "MSFT", Decimal("9"))
    db_session.commit()

    first_body = client.get("/portfolio/", headers=first_headers).json()
    second_body = client.get("/portfolio/", headers=second_headers).json()
    assert [position["symbol"] for position in first_body["positions"]] == ["AAPL"]
    assert [position["symbol"] for position in second_body["positions"]] == ["MSFT"]
    assert first_body["user"]["email"] == "one@example.com"
    assert second_body["user"]["email"] == "two@example.com"


def _book(db):
    db.expire_all()
    return {
        "users": [(row.id, str(row.cash_balance)) for row in db.query(User).order_by(User.id)],
        "holdings": [
            (row.id, str(row.quantity), str(row.avg_cost))
            for row in db.query(Holding).order_by(Holding.id)
        ],
        "orders": db.query(Order).count(),
        "lots": db.query(Lot).count(),
        "ledger": db.query(LedgerEntry).count(),
        "trades": [(row.id, str(row.realized_pnl)) for row in db.query(Trade).order_by(Trade.id)],
    }


def test_retry_matches_and_writes_nothing(client, auth_headers, db_session):
    headers = auth_headers("retry@example.com")
    user = db_session.query(User).one()
    asset = _add_position(db_session, user, "AAPL", "stock", Decimal("1"), Decimal("10"))
    _add_symbol(db_session, "AAPL")
    _add_quote(db_session, "AAPL", Decimal("12"))
    db_session.add(Trade(
        user_id=user.id,
        asset_id=asset.id,
        side="sell",
        quantity=Decimal("1"),
        price_at_execution=Decimal("12"),
        realized_pnl=Decimal("1.00"),
    ))
    db_session.commit()
    before = _book(db_session)

    engine = db_session.get_bind()
    writes = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement and statement.lstrip()[:6].lower() in {"insert", "update", "delete"}:
            writes.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        first = client.get("/portfolio/", headers=headers).json()
        second = client.get("/portfolio/", headers=headers).json()
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert writes == []
    assert _money(first) == _money(second)
    assert first["snapshot_read_at"]
    assert second["snapshot_read_at"]
    assert _book(db_session) == before


def _image(body):
    position = body["positions"][0]
    summary = body["summary"]
    return (
        position["quantity"],
        position["current_price"],
        position["position_value"],
        position["cost_basis"],
        position["unrealized_pnl"],
        summary["cash_balance"],
        summary["buying_power"],
        summary["total_realized_pnl"],
        summary["total_portfolio_value"],
        summary["total_cost_basis"],
        summary["total_unrealized_pnl"],
        summary["total_account_value"],
        summary["total_pnl"],
        body["valuation_status"],
    )


def test_concurrent_update_does_not_mix_snapshot():
    before = (
        10.0, 100.0, 1000.0, 100.0, 900.0,
        100000.0, 100000.0, 0.0, 1000.0, 100.0, 900.0, 101000.0, 900.0, "complete",
    )
    after = (
        1.0, 5.0, 5.0, 10.0, -5.0,
        1000.0, 900.0, 999.0, 5.0, 10.0, -5.0, 1005.0, 994.0, "complete",
    )
    with TemporaryDirectory() as folder:
        engine = create_engine(
            f"sqlite:///{folder}/snapshot.db",
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
        user = User(email="snap@example.com", password_hash=hash_password("password123"), cash_balance=Decimal("100000.00"))
        seed.add(user)
        seed.flush()
        asset = Asset(symbol="AAPL", asset_type="stock", name="Apple")
        seed.add(asset)
        seed.flush()
        seed.add(Holding(user_id=user.id, asset_id=asset.id, quantity=Decimal("10"), avg_cost=Decimal("10")))
        _add_symbol(seed, "AAPL")
        _add_quote(seed, "AAPL", Decimal("100"))
        seed.commit()
        user_id = user.id
        email = user.email
        asset_id = asset.id
        seed.close()

        writer = sessions()
        state = {"fired": False}

        def apply_update():
            account = writer.get(User, user_id)
            account.cash_balance = Decimal("1000.00")
            holding = writer.query(Holding).one()
            holding.quantity = Decimal("1")
            quote = writer.query(MarketQuoteCache).one()
            quote.price = Decimal("5")
            writer.add(Order(
                user_id=user_id,
                asset_id=asset_id,
                side="buy",
                order_type="limit",
                quantity=Decimal("1"),
                remaining_quantity=Decimal("1"),
                limit_price=Decimal("100"),
                status="open",
            ))
            writer.add(Trade(
                user_id=user_id,
                asset_id=asset_id,
                side="sell",
                quantity=Decimal("9"),
                price_at_execution=Decimal("100"),
                realized_pnl=Decimal("999.00"),
            ))
            writer.commit()

        def after_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
            if state["fired"] or not statement:
                return
            sql = statement.lower()
            if "holdings" in sql and "market_quote_cache" in sql and "cash_balance" in sql:
                state["fired"] = True
                apply_update()

        event.listen(engine, "after_cursor_execute", after_execute)
        try:
            reader = sessions()
            inflight = build_portfolio_response(reader, user_id, email)
            reader.close()
        finally:
            event.remove(engine, "after_cursor_execute", after_execute)

        assert state["fired"]
        assert _image(inflight) in {before, after}
        later = sessions()
        assert _image(build_portfolio_response(later, user_id, email)) == after
        later.close()
        writer.close()
        engine.dispose()


def test_portfolio_clock_sample_keeps_the_prewrite_quote(monkeypatch):
    """A quote committed while the Python clock is sampled stays out of this snapshot."""
    with TemporaryDirectory() as folder:
        engine = create_engine(
            f"sqlite:///{folder}/portfolio-clock.db",
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
        user = User(
            email="clock-pin@example.com",
            password_hash=hash_password("password123"),
            cash_balance=Decimal("1000.00"),
        )
        seed.add(user)
        seed.flush()
        _add_position(seed, user, "CLOCK", "stock", Decimal("1"), Decimal("10"))
        _add_symbol(seed, "CLOCK")
        seed.commit()
        user_id = user.id
        email = user.email
        seed.close()

        writer = sessions()
        captured = {}

        def sample_then_commit():
            sampled = datetime.now(timezone.utc).replace(tzinfo=None)
            observed = datetime.now(timezone.utc).replace(tzinfo=None)
            if observed <= sampled:
                observed = sampled + timedelta(microseconds=1)
            captured["sampled"] = sampled
            captured["observed"] = observed
            _add_quote(
                writer, "CLOCK", Decimal("20"), source="yahoo",
                quote_at=observed, fetched_at=observed,
            )
            writer.commit()
            return sampled

        import app.core.read_snapshot as read_snapshot

        real_clock = read_snapshot._python_utc_now
        monkeypatch.setattr(read_snapshot, "_python_utc_now", sample_then_commit)
        try:
            reader = sessions()
            inflight = build_portfolio_response(reader, user_id, email)
            reader.close()
            monkeypatch.setattr(read_snapshot, "_python_utc_now", real_clock)
        finally:
            if writer.in_transaction():
                writer.rollback()

        try:
            position = inflight["positions"][0]
            assert inflight["snapshot_read_at"] == _portfolio_iso(captured["sampled"])
            assert inflight["valuation_status"] == "incomplete"
            assert position["price_status"] == "unavailable"
            assert position["unavailable_reason"] == "missing"
            assert position["current_price"] is None
            assert captured["observed"] > captured["sampled"]

            later = sessions()
            follow = build_portfolio_response(later, user_id, email)
            later.close()
            follow_position = follow["positions"][0]
            follow_clock = datetime.fromisoformat(
                follow["snapshot_read_at"].replace("Z", "+00:00")
            ).replace(tzinfo=None)
            assert follow_clock > captured["observed"]
            assert follow["valuation_status"] == "complete"
            assert follow_position["price_status"] == "available"
            assert follow_position["unavailable_reason"] is None
            assert follow_position["current_price"] == float(Decimal("20"))
            assert follow["summary"]["cash_balance"] == float(Decimal("1000.00"))
            assert follow["summary"]["total_portfolio_value"] == float(Decimal("20.00"))
        finally:
            writer.close()
            engine.dispose()


def _portfolio_iso(value: datetime) -> str:
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
