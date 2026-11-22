from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.database import get_db
from app.core.security import create_access_token
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.lot import Lot
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.trade import Trade
from app.models.user import User
from app.routers.night_holding_lots import router
from app.routers.portfolio import _reset_portfolio
from app.services.ledger_service import ensure_opening
from app.services.trade_execution import execute_fill


CLOCK = datetime(2026, 11, 18, 12)
TRADE_TIME = CLOCK - timedelta(hours=1)
PATH = "/night/holdings/AAPL/lots"


@pytest.fixture
def book(db_session, monkeypatch):
    monkeypatch.setattr("app.core.read_snapshot._python_utc_now", lambda: CLOCK)
    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = lambda: db_session
    owner = User(email="fifo@example.com", password_hash="unused")
    stranger = User(email="other@example.com", password_hash="unused")
    asset = Asset(symbol="AAPL", asset_type="stock")
    db_session.add_all([owner, stranger, asset, MarketSymbol(symbol="AAPL", company_name="Apple", exchange="NASDAQ")])
    db_session.flush()
    db_session.add(MarketQuoteCache(symbol="AAPL", price=Decimal(31), source="massive",
                                    quote_at=CLOCK - timedelta(days=1), fetched_at=CLOCK))
    ensure_opening(db_session, owner, effective_on=date(2026, 10, 1))
    db_session.commit()
    return TestClient(api), owner, stranger, asset


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _fill(db, owner, asset, side, quantity, price, *, executed_at=TRADE_TIME, demo_seed=False):
    trade, _ = execute_fill(db, owner, asset, side, Decimal(quantity), Decimal(price),
                            executed_at=executed_at, demo_seed=demo_seed)
    return trade.id


def test_remaining_fifo_basis_posted_sale_and_fully_closed(book, db_session):
    client, owner, _, asset = book
    headers = _auth(owner)
    _fill(db_session, owner, asset, "buy", "2", "10.005")
    _fill(db_session, owner, asset, "buy", "2.25", "20.125")
    sale = _fill(db_session, owner, asset, "sell", "2.75", "30.25")
    # A pre-ledger legacy row has no posted cash and must not inflate realized P&L.
    db_session.add(Trade(user_id=owner.id, asset_id=asset.id, side="sell", quantity=1,
                         price_at_execution=200, executed_at=TRADE_TIME, realized_pnl=190))
    db_session.commit()

    response = client.get("/night/holdings/%20aapl%20/lots", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["symbol"] == "AAPL"
    assert body["read_at"] == "2026-11-18T12:00:00Z"
    assert body["book_started_on"] == "2026-10-01"
    assert [body[key] for key in (
        "coverage", "quantity", "cost_basis_usd", "market_value_usd", "unrealized_pnl_usd", "realized_pnl_usd",
    )] == ["available", "1.5", "30.19", "46.50", "16.31", "48.08"]
    assert body["mark"] == {
        "price": "31", "source": {"provider": "massive", "basis": "raw", "session_date": "2026-11-17",
                                  "observed_at": "2026-11-17T12:00:00Z", "coverage": "available"},
    }
    lot, = body["lots"]["items"]
    assert lot["quantity_remaining"] == "1.5"
    assert lot["cost_per_share"] == "20.125"
    assert lot["cost_basis_usd"] == "30.19"
    assert lot["unrealized_pnl_usd"] == "16.31"
    assert lot["recorded_at"].endswith("Z")
    assert body["sales"]["items"] == [{
        "trade_id": sale, "order_id": None, "executed_at": "2026-11-18T11:00:00Z", "quantity": "2.75",
        "fill_price": "30.25", "proceeds_usd": "83.19", "realized_pnl_usd": "48.08", "demo_seed": False,
    }]

    _fill(db_session, owner, asset, "sell", "1.5", "30.25")
    db_session.delete(db_session.scalar(select(Holding).where(Holding.user_id == owner.id)))
    db_session.commit()
    closed = client.get(PATH, headers=headers).json()
    assert [closed[key] for key in (
        "coverage", "quantity", "cost_basis_usd", "market_value_usd", "unrealized_pnl_usd", "realized_pnl_usd",
    )] == ["available", "0", "0.00", "0.00", "0.00", "63.27"]
    assert closed["lots"] == {"items": [], "next_cursor": None}
    assert len(closed["sales"]["items"]) == 2


def test_independent_keysets_tie_breaks_and_rounding(book, db_session):
    client, owner, stranger, asset = book
    headers = _auth(owner)
    for _ in range(4):
        _fill(db_session, owner, asset, "buy", "1", "10.005")
    for lot in db_session.scalars(select(Lot)):
        lot.created_at = TRADE_TIME
    earlier = _fill(db_session, owner, asset, "sell", "1", "15")
    later = _fill(db_session, owner, asset, "sell", "1", "16")
    db_session.commit()

    first = client.get(PATH, params={"limit": 1}, headers=headers).json()
    lot_cursor, sale_cursor = first["lots"]["next_cursor"], first["sales"]["next_cursor"]
    assert lot_cursor and sale_cursor
    assert first["cost_basis_usd"] == "20.01"
    assert first["lots"]["items"][0]["cost_basis_usd"] == "10.01"
    assert "unrounded lot values" in first["reason"]
    assert first["sales"]["items"][0]["trade_id"] == later
    second = client.get(PATH, params={"limit": 1, "sale_cursor": sale_cursor}, headers=headers).json()
    assert second["lots"] == first["lots"]
    assert second["realized_pnl_usd"] == first["realized_pnl_usd"] == "11.00"
    assert second["sales"]["items"][0]["trade_id"] == earlier
    assert second["sales"]["next_cursor"] is None
    next_lot = client.get(PATH, params={"limit": 1, "lot_cursor": lot_cursor}, headers=headers).json()
    assert next_lot["sales"] == first["sales"]
    assert next_lot["lots"]["items"][0]["id"] > first["lots"]["items"][0]["id"]
    assert next_lot["lots"]["next_cursor"] is None

    for path, auth, field, cursor in (
        (PATH, _auth(stranger), "lot_cursor", lot_cursor),
        (PATH, headers, "sale_cursor", lot_cursor),
        ("/night/holdings/MSFT/lots", headers, "sale_cursor", sale_cursor),
        (PATH, headers, "lot_cursor", "!" + lot_cursor),
    ):
        failure = client.get(path, params={field: cursor}, headers=auth)
        assert failure.status_code == 422
        assert failure.json()["detail"]["code"] == "invalid_request"
        assert field in failure.json()["detail"]["fields"]


def test_stale_missing_and_unreconciled_open_basis(book, db_session):
    client, owner, _, asset = book
    headers = _auth(owner)
    _fill(db_session, owner, asset, "buy", "2", "10")
    sale = _fill(db_session, owner, asset, "sell", "1", "15")
    quote = db_session.get(MarketQuoteCache, "AAPL")
    quote.quote_at = CLOCK - timedelta(days=14)
    db_session.commit()

    stale = client.get(PATH, headers=headers).json()
    assert stale["coverage"] == "stale"
    assert stale["mark"] is stale["market_value_usd"] is stale["unrealized_pnl_usd"] is None
    assert stale["cost_basis_usd"] == "10.00"
    assert stale["realized_pnl_usd"] == "5.00"
    assert stale["lots"]["items"][0]["unrealized_pnl_usd"] is None

    db_session.delete(quote)
    db_session.commit()
    missing = client.get(PATH, headers=headers).json()
    assert missing["coverage"] == "missing"
    assert missing["cost_basis_usd"] == "10.00"

    lot = db_session.scalar(select(Lot).where(Lot.user_id == owner.id))
    lot.qty_remaining = Decimal("0.5")
    db_session.commit()
    partial = client.get(PATH, headers=headers).json()
    assert partial["coverage"] == "partial"
    assert partial["cost_basis_usd"] is partial["unrealized_pnl_usd"] is None
    assert "does not match" in partial["reason"]
    assert partial["quantity"] == "1"
    assert partial["sales"]["items"][0]["trade_id"] == sale
    assert partial["realized_pnl_usd"] == "5.00"


def test_demo_reset_counts_only_reposted_seed_sale(book, db_session):
    client, owner, _, asset = book
    headers = _auth(owner)
    owner.demo_seed = {
        "mode": "historical", "opening_date": "2026-07-20", "fills": [
            {"symbol": "AAPL", "side": "buy", "date": "2026-08-03", "quantity": 5, "price": "10"},
            {"symbol": "AAPL", "side": "sell", "date": "2026-09-03", "quantity": 2, "price": "12"},
        ],
    }
    original = []
    for spec in owner.demo_seed["fills"]:
        original.append(_fill(db_session, owner, asset, spec["side"], spec["quantity"], spec["price"],
                              executed_at=datetime.fromisoformat(spec["date"]), demo_seed=True))
    later = _fill(db_session, owner, asset, "sell", "1", "20")
    db_session.commit()
    assert client.get(PATH, headers=headers).json()["realized_pnl_usd"] == "14.00"

    _reset_portfolio(db_session, owner.id)
    db_session.commit()
    restored = client.get(PATH, headers=headers).json()
    assert restored["book_started_on"] == "2026-07-20"
    assert restored["quantity"] == "3"
    assert restored["realized_pnl_usd"] == "4.00"
    sale, = restored["sales"]["items"]
    assert sale["trade_id"] not in {*original, later}
    assert sale["demo_seed"] is True
    assert sale["executed_at"] == "2026-09-03T00:00:00Z"
    assert restored["lots"]["items"][0]["recorded_at"] > sale["executed_at"]


def test_lots_errors_do_not_disclose_owner_or_storage_details(book, db_session):
    client, owner, stranger, asset = book
    headers = _auth(owner)
    _fill(db_session, owner, asset, "buy", "1", "10")
    db_session.commit()
    assert client.get(PATH).status_code == 401
    foreign = client.get(PATH, headers=_auth(stranger))
    unknown = client.get("/night/holdings/NOSUCH/lots", headers=headers)
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json() == unknown.json()
    assert foreign.json()["detail"]["code"] == "not_found"
    for failure in (client.get(PATH, params={"limit": 51}, headers=headers),
                    client.get("/night/holdings/$$/lots", headers=headers)):
        assert failure.status_code == 422
        assert failure.json()["detail"]["code"] == "invalid_request"

    def unavailable():
        raise OperationalError("sensitive statement", {}, Exception("unavailable"))

    client.app.dependency_overrides[get_db] = unavailable
    response = client.get(PATH, headers=headers)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "storage_unavailable"
    assert "sensitive statement" not in response.text
