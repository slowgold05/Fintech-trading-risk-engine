from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import get_db
from app.core.security import create_access_token
from app.models.asset import Asset
from app.models.ledger_entry import LedgerEntry
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.night_inbox import NightInboxRead
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import LIQUIDITY_PROVIDER_IDENTITY, User
from app.routers import night_inbox
from app.services.demo_accounts import create_demo_account, restore_demo_portfolio
from app.services.ledger_service import reconcile_account
from app.services.trade_execution import execute_fill


@pytest.fixture
def inbox_client(db_session):
    app = FastAPI()
    app.include_router(night_inbox.router)
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _owner(db, email, role="trader"):
    owner = User(email=email, password_hash="fixture", cash_balance=Decimal("10000"), role=role)
    db.add(owner)
    db.flush()
    return owner


def _receipt(db, user, asset):
    db.flush()
    order = Order(user_id=user.id, asset_id=asset.id, side="buy", order_type="limit",
                  quantity=4, remaining_quantity=2, limit_price=101, status="open")
    db.add(order)
    db.flush()
    return order


def _fill(db, user, asset, order_id, executed_at, quote_at=None):
    trade, _ = execute_fill(
        db, user, asset, "buy", Decimal("1"), Decimal("100.125"),
        order_id=order_id, executed_at=executed_at, simulated_quote_at=quote_at,
    )
    return f"fill:{trade.id}"


def test_fills_are_owned_posted_and_paginate_on_time_and_id(inbox_client, db_session):
    db = db_session
    owner = _owner(db, "owner@example.com")
    other = _owner(db, "other@example.com")
    system = _owner(db, LIQUIDITY_PROVIDER_IDENTITY)
    asset = Asset(symbol="AAPL", asset_type="stock")
    db.add(asset)
    own_order = _receipt(db, owner, asset)
    other_order = _receipt(db, other, asset)
    order_id = own_order.id
    stamp = _now() - timedelta(minutes=1)
    quote_at = stamp - timedelta(days=1)
    older = _fill(db, owner, asset, order_id, stamp)
    newer = _fill(db, owner, asset, order_id, stamp, quote_at)
    foreign = _fill(db, other, asset, other_order.id, stamp)
    system_fill = _fill(db, system, asset, order_id, stamp)
    expired = _fill(db, owner, asset, order_id, stamp - timedelta(days=30))
    future = _fill(db, owner, asset, order_id, stamp + timedelta(days=1))
    without_order = _fill(db, owner, asset, None, stamp)
    wrong_order = _fill(db, owner, asset, other_order.id, stamp)
    unposted = Trade(user_id=owner.id, asset_id=asset.id, order_id=order_id, side="buy",
                     quantity=1, price_at_execution=100, executed_at=stamp)
    db.add(unposted)
    # A marker on an ineligible source should stay invisible.
    db.add(NightInboxRead(user_id=owner.id, event_key=expired))
    db.commit()
    auth, other_auth = _auth(owner), _auth(other)
    first = inbox_client.get("/night/inbox", headers=auth, params={"limit": 1}).json()
    assert first["unread_count"] == 2 and first["history_days"] == 30
    assert first["sources"] == {"fills": True, "demo": False, "alerts": False}
    assert first["read_at"].endswith("Z")
    assert first["items"] == [{
        "id": newer, "kind": "fill", "occurred_at": stamp.isoformat() + "Z", "read_at": None,
        "symbol": "AAPL", "order_id": order_id, "alert_id": None, "side": "buy", "quantity": "1.000000",
        "price": "100.125000", "target": None, "session_date": quote_at.date().isoformat(), "source": None,
    }]
    cursor = first["next_cursor"]
    second = inbox_client.get("/night/inbox", headers=auth, params={"cursor": cursor, "limit": 1}).json()
    assert second["unread_count"] == 2 and second["next_cursor"] is None
    assert second["items"][0]["id"] == older
    assert second["items"][0]["session_date"] is None and second["items"][0]["source"] is None

    for headers, params in (
        (other_auth, {"cursor": cursor}), (auth, {"cursor": cursor, "filter": "unread"}),
        (auth, {"cursor": cursor[:-1] + ("0" if cursor[-1] != "0" else "1")}),
    ):
        rejected = inbox_client.get("/night/inbox", headers=headers, params=params)
        assert rejected.status_code == 422 and "cursor" in rejected.json()["detail"]["fields"]
    for key in (foreign, system_fill, expired, future, without_order, wrong_order, f"fill:{unposted.id}", "fill:999999"):
        rejected = inbox_client.put(f"/night/inbox/{key}/read", headers=auth)
        assert rejected.status_code == 404 and rejected.json()["detail"]["code"] == "not_found"

    url = f"/night/inbox/{newer}/read"
    mark = inbox_client.put(url, headers=auth)
    assert mark.status_code == 200 and mark.json()["read_at"].endswith("Z")
    assert inbox_client.put(url, headers=auth).json() == mark.json()
    second = inbox_client.get("/night/inbox", headers=auth, params={"cursor": cursor}).json()
    assert second["unread_count"] == 1 and [item["id"] for item in second["items"]] == [older]
    unread = inbox_client.get("/night/inbox", headers=auth, params={"filter": "unread"}).json()
    assert unread["unread_count"] == 1 and [item["id"] for item in unread["items"]] == [older]
    reread = inbox_client.get("/night/inbox", headers=auth).json()
    assert reread["items"][0]["read_at"] == mark.json()["read_at"]
    assert reconcile_account(db, owner)["ok"]


def test_demo_book_projects_opening_and_only_latest_actual_reset(inbox_client, db_session):
    db = db_session
    db.add(MarketSymbol(symbol="AAPL", company_name="Apple", exchange="NASDAQ"))
    stamp = _now() - timedelta(minutes=1)
    db.add(MarketQuoteCache(symbol="AAPL", price=100, source="fixture", quote_at=stamp, fetched_at=stamp))
    db.flush()
    demo = create_demo_account(db)
    assert db.scalar(select(Trade).where(Trade.user_id == demo.id)).demo_seed
    db.commit()
    auth = _auth(demo)
    url = "/night/inbox"
    opening = inbox_client.get(url, headers=auth).json()
    assert opening["sources"] == {"fills": True, "demo": True, "alerts": False}
    assert opening["unread_count"] == 1
    started, = opening["items"]
    opening_post = db.scalars(select(LedgerEntry).where(LedgerEntry.user_id == demo.id,
                                                        LedgerEntry.event_kind == "opening_snapshot")).first()
    assert started["id"] == f"demo_started:{opening_post.event_id}"
    assert started["occurred_at"] == opening_post.created_at.isoformat() + "Z"
    assert started["session_date"] is None
    asset = db.scalar(select(Asset).where(Asset.symbol == "AAPL"))
    order = _receipt(db, demo, asset)
    customer_fill = _fill(db, demo, asset, order.id, stamp)
    db.commit()
    assert inbox_client.get(url, headers=auth).json()["unread_count"] == 2
    assert inbox_client.put(f"{url}/{customer_fill}/read", headers=auth).status_code == 200
    reset_ids = []
    for _ in range(2):
        restore_demo_portfolio(db, demo)
        db.commit()
        reset_post = db.scalars(
            select(LedgerEntry).where(LedgerEntry.user_id == demo.id, LedgerEntry.event_kind == "reset")
            .order_by(LedgerEntry.id.desc())
        ).first()
        reset_ids.append(f"demo_reset:{reset_post.event_id}")
        page = inbox_client.get(url, headers=auth).json()
        assert {item["id"] for item in page["items"]} == {started["id"], reset_ids[-1]}
        assert next(item for item in page["items"] if item["id"] == reset_ids[-1])["occurred_at"] == (
            reset_post.created_at.isoformat() + "Z"
        )
        assert page["unread_count"] == 2
        if len(reset_ids) == 1:
            assert inbox_client.put(f"{url}/{reset_ids[0]}/read", headers=auth).status_code == 200
            _fill(db, demo, asset, order.id, stamp)
            db.commit()

    restore_demo_portfolio(db, demo)
    db.commit()
    again = inbox_client.get(url, headers=auth).json()
    assert again["items"] == page["items"] and again["unread_count"] == page["unread_count"]
    for key in (reset_ids[0], customer_fill):
        assert inbox_client.put(f"{url}/{key}/read", headers=auth).status_code == 404
    assert reconcile_account(db, demo)["ok"]


def test_inbox_auth_validation_empty_and_storage_failure(inbox_client, db_session, monkeypatch):
    owner = _owner(db_session, "owner@example.com")
    analyst = _owner(db_session, "analyst@example.com", "analyst")
    db_session.commit()
    auth = _auth(owner)
    assert inbox_client.get("/night/inbox").status_code == 401
    assert inbox_client.put("/night/inbox/fill:1/read").status_code == 401
    assert inbox_client.get("/night/inbox", headers=_auth(analyst)).status_code == 403
    assert inbox_client.put("/night/inbox/fill:1/read", headers=_auth(analyst)).status_code == 403
    empty = inbox_client.get("/night/inbox", headers=auth).json()
    assert (empty["items"], empty["unread_count"], empty["next_cursor"]) == ([], 0, None)
    for field, value in (("filter", "any"), ("limit", 0), ("limit", 51), ("user_id", 2)):
        result = inbox_client.get("/night/inbox", headers=auth, params={field: value})
        assert result.status_code == 422
        assert result.json()["detail"]["code"] == "invalid_request"
        assert field in result.json()["detail"]["fields"]
    invalid = inbox_client.put("/night/inbox/fill:0/read", headers=auth)
    assert invalid.status_code == 422 and "id" in invalid.json()["detail"]["fields"]
    payload = inbox_client.put("/night/inbox/fill:1/read", headers=auth, json={"user_id": 1})
    assert payload.status_code == 422 and "body" in payload.json()["detail"]["fields"]

    def fail(*args):
        raise SQLAlchemyError("storage failure containing private details")

    monkeypatch.setattr(night_inbox, "list_inbox", fail)
    failed = inbox_client.get("/night/inbox", headers=auth)
    assert failed.status_code == 503
    assert failed.json() == {"detail": {"code": "storage_unavailable", "message": "Inbox storage is unavailable."}}
