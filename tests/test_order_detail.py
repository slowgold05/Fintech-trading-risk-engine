"""GET /orders/{order_id} reads. Money and PnL expectations are hand-calculated."""

import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read as real_consistent_read
from app.core.read_snapshot import snapshot_clock as real_snapshot_clock
from app.core.read_snapshot import SnapshotClockError
from app.models.asset import Asset
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import User

DETAIL = "/orders/{order_id}"
ORDER_KEYS = {
    "order_id",
    "symbol",
    "side",
    "order_type",
    "status",
    "currency",
    "quantity",
    "filled_quantity",
    "remaining_quantity",
    "limit_price",
    "created_at",
    "canceled_at",
    "read_at",
    "total_fill_count",
    "limit",
    "has_more",
    "next_after_id",
    "fills",
}
FILL_KEYS = {
    "trade_id",
    "quantity",
    "execution_price",
    "notional",
    "realized_pnl",
    "executed_at",
}
BANNED_KEYS = {
    "user_id",
    "buyer_id",
    "seller_id",
    "counterparty_id",
    "counterparty_user_id",
    "cash",
    "cash_balance",
    "reserved_cash",
    "buying_power",
    "email",
    "realized_pnl_pct",
}
UTC_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
SIX = re.compile(r"^\d+\.\d{6}$")
MONEY = re.compile(r"^-?\d+\.\d{2}$")
WRITE_SQL = re.compile(r"\b(INSERT|UPDATE|DELETE|FOR\s+UPDATE)\b", re.IGNORECASE)
FIXED_CLOCK = datetime(2026, 11, 6, 18, 0, 0, 250000)
FIXED_CLOCK_Z = "2026-11-06T18:00:00.250000Z"
STAFF_ROLES = ("analyst", "compliance_officer", "admin", "auditor")


def _z(value: datetime) -> str:
    assert value.tzinfo is None
    return value.isoformat() + "Z"


def _seed_quote(db: Session) -> None:
    db.add(MarketSymbol(symbol="AAPL", company_name="Apple", exchange="NASDAQ", is_active=True))
    db.flush()
    db.add(MarketQuoteCache(
        symbol="AAPL",
        price=Decimal("100"),
        change_amount=0,
        change_percent=0,
        volume=0,
        source="yahoo",
        quote_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ))
    db.commit()


def _user_id(db: Session, email: str) -> int:
    return int(db.query(User.id).filter(User.email == email).scalar())


def _asset(db: Session, symbol: str = "AAPL") -> Asset:
    asset = Asset(symbol=symbol, asset_type="stock", name=symbol, is_active=True)
    db.add(asset)
    db.flush()
    return asset


def _post_trade(client, headers, quantity: str, side: str = "buy"):
    return client.post(
        "/trades/",
        headers={**headers, "Idempotency-Key": uuid4().hex},
        json={"symbol": "AAPL", "asset_type": "stock", "side": side, "quantity": quantity},
    )


def _post_limit(client, headers, side: str, quantity: str, price: str):
    return client.post(
        "/orders/",
        headers={**headers, "Idempotency-Key": uuid4().hex},
        json={"symbol": "AAPL", "side": side, "quantity": quantity, "limit_price": price},
    )


def _post_market(client, headers, quantity: str):
    return client.post(
        "/orders/",
        headers={**headers, "Idempotency-Key": uuid4().hex},
        json={"symbol": "AAPL", "side": "buy", "order_type": "market", "quantity": quantity},
    )


def _keys(node) -> set[str]:
    found: set[str] = set()
    if isinstance(node, dict):
        found.update(node)
        for value in node.values():
            found.update(_keys(value))
    elif isinstance(node, list):
        for item in node:
            found.update(_keys(item))
    return found


def _assert_legacy(body: dict, trade_ids: list[int] | None = None) -> None:
    assert "id" in body and type(body["id"]) is int
    assert "order_id" not in body and "fills" not in body
    assert "filled_quantity" not in body and "currency" not in body and "read_at" not in body
    assert isinstance(body["quantity"], (int, float)) and not isinstance(body["quantity"], str)
    assert isinstance(body["remaining_quantity"], (int, float))
    assert body["limit_price"] is None or isinstance(body["limit_price"], (int, float))
    if trade_ids is not None:
        assert body["trade_ids"] == trade_ids


def _assert_detail(body: dict, **expected) -> None:
    assert set(body) == ORDER_KEYS
    assert BANNED_KEYS.isdisjoint(_keys(body))
    assert body["currency"] == "USD"
    assert type(body["order_id"]) is int
    assert type(body["total_fill_count"]) is int
    assert type(body["limit"]) is int
    assert type(body["has_more"]) is bool
    assert body["next_after_id"] is None or type(body["next_after_id"]) is int
    assert SIX.fullmatch(body["quantity"])
    assert SIX.fullmatch(body["filled_quantity"])
    assert SIX.fullmatch(body["remaining_quantity"])
    assert body["limit_price"] is None or SIX.fullmatch(body["limit_price"])
    assert UTC_Z.fullmatch(body["created_at"])
    assert UTC_Z.fullmatch(body["read_at"])
    assert body["canceled_at"] is None or UTC_Z.fullmatch(body["canceled_at"])
    assert isinstance(body["fills"], list)
    assert len(body["fills"]) <= body["total_fill_count"]
    for fill in body["fills"]:
        assert set(fill) == FILL_KEYS
        assert type(fill["trade_id"]) is int
        assert SIX.fullmatch(fill["quantity"])
        assert SIX.fullmatch(fill["execution_price"])
        assert MONEY.fullmatch(fill["notional"])
        assert MONEY.fullmatch(fill["realized_pnl"])
        assert UTC_Z.fullmatch(fill["executed_at"])
    for key, value in expected.items():
        assert body[key] == value


def _owned_trade(db: Session, order_id: int, user_id: int) -> Trade:
    db.expire_all()
    return db.query(Trade).filter(Trade.order_id == order_id, Trade.user_id == user_id).one()


def test_limit_partial_fill_survives_cancel(client, auth_headers, db_session: Session) -> None:
    _seed_quote(db_session)
    seller_headers = auth_headers("seller-detail@example.com")
    buyer_headers = auth_headers("buyer-detail@example.com")
    seller_id = _user_id(db_session, "seller-detail@example.com")
    buyer_id = _user_id(db_session, "buyer-detail@example.com")

    opened = _post_trade(client, seller_headers, "2")
    assert opened.status_code == 200, opened.text
    ask = _post_limit(client, seller_headers, "sell", "2", "90")
    assert ask.status_code == 200, ask.text
    ask_body = ask.json()
    _assert_legacy(ask_body, trade_ids=[])
    assert ask_body["status"] == "open"
    assert ask_body["quantity"] == 2
    assert ask_body["remaining_quantity"] == 2
    assert ask_body["limit_price"] == 90
    ask_id = ask_body["id"]

    listed = client.get("/orders/", headers=seller_headers)
    assert listed.status_code == 200
    listed_ask = next(row for row in listed.json()["orders"] if row["id"] == ask_id)
    _assert_legacy(listed_ask)
    assert listed_ask["remaining_quantity"] == 2

    bid = _post_limit(client, buyer_headers, "buy", "1", "95")
    assert bid.status_code == 200, bid.text
    bid_body = bid.json()
    _assert_legacy(bid_body)
    assert bid_body["status"] == "filled"
    assert bid_body["quantity"] == 1
    assert len(bid_body["trade_ids"]) == 2
    bid_id = bid_body["id"]

    db_session.expire_all()
    immediate = db_session.query(Trade).filter(Trade.user_id == seller_id, Trade.order_id.is_(None)).one()
    sell_trade = _owned_trade(db_session, ask_id, seller_id)
    buy_trade = _owned_trade(db_session, bid_id, buyer_id)
    ask_row = db_session.get(Order, ask_id)
    bid_row = db_session.get(Order, bid_id)

    seller_view = client.get(DETAIL.format(order_id=ask_id), headers=seller_headers)
    assert seller_view.status_code == 200, seller_view.text
    seller_open = seller_view.json()
    _assert_detail(
        seller_open,
        order_id=ask_id,
        symbol="AAPL",
        side="sell",
        order_type="limit",
        status="open",
        quantity="2.000000",
        filled_quantity="1.000000",
        remaining_quantity="1.000000",
        limit_price="90.000000",
        created_at=_z(ask_row.created_at),
        canceled_at=None,
        total_fill_count=1,
        limit=50,
        has_more=False,
        next_after_id=None,
    )
    assert seller_open["fills"] == [{
        "trade_id": sell_trade.id,
        "quantity": "1.000000",
        "execution_price": "90.000000",
        "notional": "90.00",
        "realized_pnl": "-10.00",
        "executed_at": _z(sell_trade.executed_at),
    }]
    assert immediate.id not in {fill["trade_id"] for fill in seller_open["fills"]}
    assert buy_trade.id not in {fill["trade_id"] for fill in seller_open["fills"]}

    buyer_view = client.get(DETAIL.format(order_id=bid_id), headers=buyer_headers)
    assert buyer_view.status_code == 200, buyer_view.text
    buyer_filled = buyer_view.json()
    _assert_detail(
        buyer_filled,
        order_id=bid_id,
        symbol="AAPL",
        side="buy",
        order_type="limit",
        status="filled",
        quantity="1.000000",
        filled_quantity="1.000000",
        remaining_quantity="0.000000",
        limit_price="95.000000",
        created_at=_z(bid_row.created_at),
        canceled_at=None,
        total_fill_count=1,
        limit=50,
        has_more=False,
        next_after_id=None,
    )
    assert buyer_filled["fills"] == [{
        "trade_id": buy_trade.id,
        "quantity": "1.000000",
        "execution_price": "90.000000",
        "notional": "90.00",
        "realized_pnl": "0.00",
        "executed_at": _z(buy_trade.executed_at),
    }]
    assert sell_trade.id not in {fill["trade_id"] for fill in buyer_filled["fills"]}

    canceled = client.post(f"/orders/{ask_id}/cancel", headers=seller_headers)
    assert canceled.status_code == 200, canceled.text
    canceled_legacy = canceled.json()
    _assert_legacy(canceled_legacy)
    assert canceled_legacy["status"] == "canceled"
    assert canceled_legacy["quantity"] == 2
    assert canceled_legacy["remaining_quantity"] == 1

    db_session.expire_all()
    ask_row = db_session.get(Order, ask_id)
    seller_after = client.get(DETAIL.format(order_id=ask_id), headers=seller_headers)
    assert seller_after.status_code == 200, seller_after.text
    seller_canceled = seller_after.json()
    _assert_detail(
        seller_canceled,
        order_id=ask_id,
        status="canceled",
        quantity="2.000000",
        filled_quantity="1.000000",
        remaining_quantity="1.000000",
        limit_price="90.000000",
        canceled_at=_z(ask_row.canceled_at),
        total_fill_count=1,
        fills=seller_open["fills"],
    )

    again = client.post(f"/orders/{ask_id}/cancel", headers=seller_headers)
    assert again.status_code == 409
    assert again.json()["detail"] == "Order is no longer open"


def test_filled_order_and_canceled_market_routes(client, auth_headers, db_session: Session) -> None:
    _seed_quote(db_session)
    empty_headers = auth_headers("market-empty@example.com")
    seller_headers = auth_headers("market-seller@example.com")
    buyer_headers = auth_headers("market-buyer@example.com")
    seller_id = _user_id(db_session, "market-seller@example.com")
    buyer_id = _user_id(db_session, "market-buyer@example.com")

    empty = _post_market(client, empty_headers, "1")
    assert empty.status_code == 200, empty.text
    empty_legacy = empty.json()
    _assert_legacy(empty_legacy, trade_ids=[])
    assert empty_legacy["status"] == "canceled"
    assert empty_legacy["order_type"] == "market"
    assert empty_legacy["quantity"] == 1
    assert empty_legacy["remaining_quantity"] == 1
    assert empty_legacy["limit_price"] is None
    empty_id = empty_legacy["id"]
    db_session.expire_all()
    empty_row = db_session.get(Order, empty_id)
    empty_view = client.get(DETAIL.format(order_id=empty_id), headers=empty_headers)
    assert empty_view.status_code == 200, empty_view.text
    _assert_detail(
        empty_view.json(),
        order_id=empty_id,
        symbol="AAPL",
        side="buy",
        order_type="market",
        status="canceled",
        quantity="1.000000",
        filled_quantity="0.000000",
        remaining_quantity="1.000000",
        limit_price=None,
        created_at=_z(empty_row.created_at),
        canceled_at=_z(empty_row.canceled_at),
        total_fill_count=0,
        limit=50,
        has_more=False,
        next_after_id=None,
        fills=[],
    )

    assert _post_trade(client, seller_headers, "2").status_code == 200
    resting = _post_limit(client, seller_headers, "sell", "2", "105")
    assert resting.status_code == 200, resting.text
    ask_id = resting.json()["id"]
    partial = _post_market(client, buyer_headers, "3")
    assert partial.status_code == 200, partial.text
    partial_legacy = partial.json()
    _assert_legacy(partial_legacy)
    assert partial_legacy["status"] == "canceled"
    assert partial_legacy["quantity"] == 3
    assert partial_legacy["remaining_quantity"] == 1
    assert partial_legacy["limit_price"] is None
    assert len(partial_legacy["trade_ids"]) == 2
    partial_id = partial_legacy["id"]

    db_session.expire_all()
    sell_trade = _owned_trade(db_session, ask_id, seller_id)
    buy_trade = _owned_trade(db_session, partial_id, buyer_id)
    immediate_id = db_session.query(Trade.id).filter(Trade.user_id == seller_id, Trade.order_id.is_(None)).scalar()
    ask_row = db_session.get(Order, ask_id)
    partial_row = db_session.get(Order, partial_id)

    filled = client.get(DETAIL.format(order_id=ask_id), headers=seller_headers)
    assert filled.status_code == 200, filled.text
    filled_body = filled.json()
    _assert_detail(
        filled_body,
        order_id=ask_id,
        side="sell",
        order_type="limit",
        status="filled",
        quantity="2.000000",
        filled_quantity="2.000000",
        remaining_quantity="0.000000",
        limit_price="105.000000",
        created_at=_z(ask_row.created_at),
        canceled_at=None,
        total_fill_count=1,
        fills=[{
            "trade_id": sell_trade.id,
            "quantity": "2.000000",
            "execution_price": "105.000000",
            "notional": "210.00",
            "realized_pnl": "10.00",
            "executed_at": _z(sell_trade.executed_at),
        }],
    )
    assert immediate_id not in {fill["trade_id"] for fill in filled_body["fills"]}

    partial_view = client.get(DETAIL.format(order_id=partial_id), headers=buyer_headers)
    assert partial_view.status_code == 200, partial_view.text
    partial_body = partial_view.json()
    _assert_detail(
        partial_body,
        order_id=partial_id,
        side="buy",
        order_type="market",
        status="canceled",
        quantity="3.000000",
        filled_quantity="2.000000",
        remaining_quantity="1.000000",
        limit_price=None,
        created_at=_z(partial_row.created_at),
        canceled_at=_z(partial_row.canceled_at),
        total_fill_count=1,
        has_more=False,
        next_after_id=None,
        fills=[{
            "trade_id": buy_trade.id,
            "quantity": "2.000000",
            "execution_price": "105.000000",
            "notional": "210.00",
            "realized_pnl": "0.00",
            "executed_at": _z(buy_trade.executed_at),
        }],
    )
    assert sell_trade.id != buy_trade.id
    assert sell_trade.id not in {fill["trade_id"] for fill in partial_body["fills"]}
    assert set(partial_legacy["trade_ids"]) == {sell_trade.id, buy_trade.id}


def test_authentication_and_unknown_orders(client, auth_headers, db_session: Session) -> None:
    owner_headers = auth_headers("owner-detail@example.com")
    other_headers = auth_headers("other-detail@example.com")
    owner_id = _user_id(db_session, "owner-detail@example.com")
    asset = _asset(db_session)
    owned = Order(
        user_id=owner_id,
        asset_id=asset.id,
        side="buy",
        order_type="limit",
        quantity=Decimal("1.000000"),
        remaining_quantity=Decimal("1.000000"),
        limit_price=Decimal("10.000000"),
        status="open",
        created_at=datetime(2026, 1, 15, 12, 0, 0),
    )
    db_session.add(owned)
    db_session.commit()

    anonymous = client.get(DETAIL.format(order_id=owned.id))
    assert anonymous.status_code == 401

    own = client.get(DETAIL.format(order_id=owned.id), headers=owner_headers)
    assert own.status_code == 200, own.text
    assert own.json()["order_id"] == owned.id
    assert own.json()["status"] == "open"

    missing_id = 888888888
    assert db_session.get(Order, missing_id) is None
    stranger = client.get(DETAIL.format(order_id=owned.id), headers=other_headers)
    unknown = client.get(DETAIL.format(order_id=missing_id), headers=owner_headers)
    assert stranger.status_code == unknown.status_code == 404
    assert stranger.json() == unknown.json() == {"detail": "Order not found"}

    for role in STAFF_ROLES:
        email = f"{role}@example.com"
        headers = auth_headers(email)
        user = db_session.query(User).filter(User.email == email).one()
        user.role = role
        staff_order = Order(
            user_id=user.id,
            asset_id=asset.id,
            side="sell",
            order_type="limit",
            quantity=Decimal("1.000000"),
            remaining_quantity=Decimal("1.000000"),
            limit_price=Decimal("11.000000"),
            status="open",
            created_at=datetime(2026, 1, 15, 12, 30, 0),
        )
        db_session.add(staff_order)
        db_session.commit()
        allowed = client.get(DETAIL.format(order_id=staff_order.id), headers=headers)
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["order_id"] == staff_order.id
        denied = client.get(DETAIL.format(order_id=owned.id), headers=headers)
        assert denied.status_code == 404
        assert denied.json() == {"detail": "Order not found"}


def test_exact_decimals_half_cent_and_timestamps(client, auth_headers, db_session: Session) -> None:
    headers = auth_headers("decimals@example.com")
    owner_id = _user_id(db_session, "decimals@example.com")
    asset = _asset(db_session)
    created = datetime(2026, 3, 4, 5, 6, 7, 890123)
    executed = datetime(2026, 3, 4, 5, 6, 8, 1)
    # Full Numeric(18, 6) precision is proved in PostgreSQL. SQLite NUMERIC uses floating-point storage.
    large = Order(
        user_id=owner_id,
        asset_id=asset.id,
        side="buy",
        order_type="limit",
        quantity=Decimal("123456.123456"),
        remaining_quantity=Decimal("0.000001"),
        limit_price=Decimal("999.999999"),
        status="open",
        created_at=created,
    )
    db_session.add(large)
    db_session.flush()
    large_fill = Trade(
        user_id=owner_id,
        asset_id=asset.id,
        order_id=large.id,
        side="buy",
        quantity=Decimal("123456.123455"),
        price_at_execution=Decimal("1.000000"),
        realized_pnl=Decimal("0.00"),
        realized_pnl_pct=Decimal("0"),
        executed_at=executed,
    )
    half_created = datetime(2026, 8, 9, 10, 11, 12)
    half_canceled = datetime(2026, 8, 9, 10, 12, 13, 900000)
    half_executed = datetime(2026, 8, 9, 10, 11, 30)
    half = Order(
        user_id=owner_id,
        asset_id=asset.id,
        side="buy",
        order_type="market",
        quantity=Decimal("2.000000"),
        remaining_quantity=Decimal("0.000000"),
        limit_price=None,
        status="canceled",
        created_at=half_created,
        canceled_at=half_canceled,
    )
    db_session.add(half)
    db_session.flush()
    half_fill = Trade(
        user_id=owner_id,
        asset_id=asset.id,
        order_id=half.id,
        side="buy",
        quantity=Decimal("1.000000"),
        price_at_execution=Decimal("10.005000"),
        realized_pnl=Decimal("-1.25"),
        realized_pnl_pct=Decimal("-1"),
        executed_at=half_executed,
    )
    zero_fill = Trade(
        user_id=owner_id,
        asset_id=asset.id,
        order_id=half.id,
        side="buy",
        quantity=Decimal("1.000000"),
        price_at_execution=Decimal("10.005000"),
        realized_pnl=Decimal("0.00"),
        realized_pnl_pct=Decimal("0"),
        executed_at=datetime(2026, 8, 9, 10, 11, 31, 5),
    )
    db_session.add_all([large_fill, half_fill, zero_fill])
    db_session.commit()

    large_view = client.get(DETAIL.format(order_id=large.id), headers=headers)
    assert large_view.status_code == 200, large_view.text
    large_body = large_view.json()
    _assert_detail(
        large_body,
        order_id=large.id,
        quantity="123456.123456",
        filled_quantity="123456.123455",
        remaining_quantity="0.000001",
        limit_price="999.999999",
        status="open",
        canceled_at=None,
        created_at="2026-03-04T05:06:07.890123Z",
        total_fill_count=1,
        fills=[{
            "trade_id": large_fill.id,
            "quantity": "123456.123455",
            "execution_price": "1.000000",
            "notional": "123456.12",
            "realized_pnl": "0.00",
            "executed_at": "2026-03-04T05:06:08.000001Z",
        }],
    )

    half_view = client.get(DETAIL.format(order_id=half.id), headers=headers)
    assert half_view.status_code == 200, half_view.text
    half_body = half_view.json()
    _assert_detail(
        half_body,
        order_id=half.id,
        order_type="market",
        status="canceled",
        quantity="2.000000",
        filled_quantity="2.000000",
        remaining_quantity="0.000000",
        limit_price=None,
        created_at="2026-08-09T10:11:12Z",
        canceled_at="2026-08-09T10:12:13.900000Z",
        total_fill_count=2,
        has_more=False,
        next_after_id=None,
    )
    assert half_body["fills"] == [
        {
            "trade_id": half_fill.id,
            "quantity": "1.000000",
            "execution_price": "10.005000",
            "notional": "10.01",
            "realized_pnl": "-1.25",
            "executed_at": "2026-08-09T10:11:30Z",
        },
        {
            "trade_id": zero_fill.id,
            "quantity": "1.000000",
            "execution_price": "10.005000",
            "notional": "10.01",
            "realized_pnl": "0.00",
            "executed_at": "2026-08-09T10:11:31.000005Z",
        },
    ]


def test_fills_are_owner_rows_for_this_order(client, auth_headers, db_session: Session) -> None:
    headers = auth_headers("filter-owner@example.com")
    other_headers = auth_headers("filter-other@example.com")
    owner_id = _user_id(db_session, "filter-owner@example.com")
    other_id = _user_id(db_session, "filter-other@example.com")
    asset = _asset(db_session)
    order = Order(
        user_id=owner_id,
        asset_id=asset.id,
        side="sell",
        order_type="limit",
        quantity=Decimal("1.000000"),
        remaining_quantity=Decimal("0.000000"),
        limit_price=Decimal("12.500000"),
        status="filled",
        created_at=datetime(2026, 6, 1, 9, 0, 0),
    )
    db_session.add(order)
    db_session.flush()
    owned = Trade(
        user_id=owner_id,
        asset_id=asset.id,
        order_id=order.id,
        side="sell",
        quantity=Decimal("1.000000"),
        price_at_execution=Decimal("12.500000"),
        realized_pnl=Decimal("0.00"),
        realized_pnl_pct=Decimal("0"),
        executed_at=datetime(2026, 6, 1, 9, 1, 0),
    )
    immediate = Trade(
        user_id=owner_id,
        asset_id=asset.id,
        order_id=None,
        side="buy",
        quantity=Decimal("1.000000"),
        price_at_execution=Decimal("100.000000"),
        realized_pnl=Decimal("0.00"),
        realized_pnl_pct=Decimal("0"),
        executed_at=datetime(2026, 6, 1, 8, 0, 0),
    )
    counterparty = Trade(
        user_id=other_id,
        asset_id=asset.id,
        order_id=order.id,
        side="buy",
        quantity=Decimal("1.000000"),
        price_at_execution=Decimal("12.500000"),
        realized_pnl=Decimal("-2.00"),
        realized_pnl_pct=Decimal("0"),
        executed_at=datetime(2026, 6, 1, 9, 1, 0),
    )
    db_session.add_all([owned, immediate, counterparty])
    db_session.commit()

    response = client.get(DETAIL.format(order_id=order.id), headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    _assert_detail(
        body,
        order_id=order.id,
        total_fill_count=1,
        filled_quantity="1.000000",
        remaining_quantity="0.000000",
        limit_price="12.500000",
        fills=[{
            "trade_id": owned.id,
            "quantity": "1.000000",
            "execution_price": "12.500000",
            "notional": "12.50",
            "realized_pnl": "0.00",
            "executed_at": "2026-06-01T09:01:00Z",
        }],
    )
    assert immediate.id not in {fill["trade_id"] for fill in body["fills"]}
    assert counterparty.id not in {fill["trade_id"] for fill in body["fills"]}
    assert "-2.00" not in response.text
    assert other_headers["Authorization"] not in response.text
    hidden = client.get(DETAIL.format(order_id=order.id), headers=other_headers)
    assert hidden.status_code == 404
    assert hidden.json() == {"detail": "Order not found"}


def test_cursor_pages_do_not_overlap(client, auth_headers, db_session: Session) -> None:
    headers = auth_headers("pages@example.com")
    owner_id = _user_id(db_session, "pages@example.com")
    asset = _asset(db_session)
    order = Order(
        user_id=owner_id,
        asset_id=asset.id,
        side="buy",
        order_type="limit",
        quantity=Decimal("101.000000"),
        remaining_quantity=Decimal("0.000000"),
        limit_price=Decimal("2.000000"),
        status="filled",
        created_at=datetime(2026, 5, 1, 0, 0, 0),
    )
    db_session.add(order)
    db_session.flush()
    base = datetime(2026, 5, 2, 0, 0, 0)
    for index in range(101):
        db_session.add(Trade(
            user_id=owner_id,
            asset_id=asset.id,
            order_id=order.id,
            side="buy",
            quantity=Decimal("1.000000"),
            price_at_execution=Decimal("2.000000"),
            realized_pnl=Decimal("0.00"),
            realized_pnl_pct=Decimal("0"),
            executed_at=base + timedelta(seconds=(index * 7) % 101),
        ))
    db_session.commit()
    owned_ids = [
        row.id for row in db_session.query(Trade.id).filter(
            Trade.order_id == order.id,
            Trade.user_id == owner_id,
        ).order_by(Trade.id.asc())
    ]
    assert len(owned_ids) == 101

    default = client.get(DETAIL.format(order_id=order.id), headers=headers)
    assert default.status_code == 200, default.text
    default_body = default.json()
    _assert_detail(
        default_body,
        total_fill_count=101,
        limit=50,
        has_more=True,
        next_after_id=owned_ids[49],
    )
    assert [fill["trade_id"] for fill in default_body["fills"]] == owned_ids[:50]
    assert default_body["fills"][0]["quantity"] == "1.000000"
    assert default_body["fills"][0]["execution_price"] == "2.000000"
    assert default_body["fills"][0]["notional"] == "2.00"
    assert default_body["fills"][0]["realized_pnl"] == "0.00"

    second = client.get(
        DETAIL.format(order_id=order.id),
        headers=headers,
        params={"limit": 50, "after_id": default_body["next_after_id"]},
    )
    assert second.status_code == 200, second.text
    second_body = second.json()
    _assert_detail(
        second_body,
        total_fill_count=101,
        limit=50,
        has_more=True,
        next_after_id=owned_ids[99],
    )
    assert [fill["trade_id"] for fill in second_body["fills"]] == owned_ids[50:100]
    assert set(owned_ids[:50]).isdisjoint(fill["trade_id"] for fill in second_body["fills"])

    wide = client.get(DETAIL.format(order_id=order.id), headers=headers, params={"limit": 100})
    assert wide.status_code == 200, wide.text
    wide_body = wide.json()
    _assert_detail(wide_body, total_fill_count=101, limit=100, has_more=True, next_after_id=owned_ids[99])
    assert [fill["trade_id"] for fill in wide_body["fills"]] == owned_ids[:100]

    first = client.get(DETAIL.format(order_id=order.id), headers=headers, params={"limit": 1})
    assert first.status_code == 200, first.text
    first_body = first.json()
    _assert_detail(first_body, total_fill_count=101, limit=1, has_more=True, next_after_id=owned_ids[0])
    assert [fill["trade_id"] for fill in first_body["fills"]] == [owned_ids[0]]

    nxt = client.get(
        DETAIL.format(order_id=order.id),
        headers=headers,
        params={"limit": 1, "after_id": first_body["next_after_id"]},
    )
    assert nxt.status_code == 200, nxt.text
    nxt_body = nxt.json()
    _assert_detail(nxt_body, total_fill_count=101, limit=1, has_more=True, next_after_id=owned_ids[1])
    assert [fill["trade_id"] for fill in nxt_body["fills"]] == [owned_ids[1]]

    far = client.get(
        DETAIL.format(order_id=order.id),
        headers=headers,
        params={"after_id": 2_000_000_000},
    )
    assert far.status_code == 200, far.text
    far_body = far.json()
    _assert_detail(
        far_body,
        total_fill_count=101,
        limit=50,
        has_more=False,
        next_after_id=None,
        fills=[],
    )
    assert far_body["order_id"] == order.id


def test_invalid_order_detail_parameters(client, auth_headers, db_session: Session) -> None:
    headers = auth_headers("invalid-detail@example.com")
    owner_id = _user_id(db_session, "invalid-detail@example.com")
    asset = _asset(db_session)
    order = Order(
        user_id=owner_id,
        asset_id=asset.id,
        side="buy",
        order_type="limit",
        quantity=Decimal("1"),
        remaining_quantity=Decimal("1"),
        limit_price=Decimal("5"),
        status="open",
        created_at=datetime(2026, 7, 1, 0, 0, 0),
    )
    db_session.add(order)
    db_session.commit()
    paths = [
        "/orders/0",
        "/orders/-1",
        "/orders/abc",
        "/orders/1.5",
        f"/orders/{order.id}?limit=0",
        f"/orders/{order.id}?limit=101",
        f"/orders/{order.id}?limit=no",
        f"/orders/{order.id}?limit=1.5",
        f"/orders/{order.id}?after_id=0",
        f"/orders/{order.id}?after_id=-5",
        f"/orders/{order.id}?after_id=no",
    ]
    for path in paths:
        response = client.get(path, headers=headers)
        assert response.status_code == 422, path

    absent = client.get(DETAIL.format(order_id=order.id), headers=headers)
    assert absent.status_code == 200, absent.text
    assert absent.json()["limit"] == 50
    assert absent.json()["fills"] == []
    assert absent.json()["total_fill_count"] == 0


def _counts(db: Session, user_id: int) -> tuple[int, int]:
    db.rollback()
    db.expire_all()
    return (
        db.query(Order).filter(Order.user_id == user_id).count(),
        db.query(Trade).filter(Trade.user_id == user_id).count(),
    )


def test_detail_read_is_sql_readonly_and_clock_errors_propagate(client, auth_headers, db_session: Session, monkeypatch) -> None:
    headers = auth_headers("readonly-detail@example.com")
    owner_id = _user_id(db_session, "readonly-detail@example.com")
    asset = _asset(db_session)
    order = Order(
        user_id=owner_id,
        asset_id=asset.id,
        side="buy",
        order_type="limit",
        quantity=Decimal("1.000000"),
        remaining_quantity=Decimal("0.000000"),
        limit_price=Decimal("4.000000"),
        status="filled",
        created_at=datetime(2026, 10, 1, 8, 0, 0),
    )
    db_session.add(order)
    db_session.flush()
    fill = Trade(
        user_id=owner_id,
        asset_id=asset.id,
        order_id=order.id,
        side="buy",
        quantity=Decimal("1.000000"),
        price_at_execution=Decimal("4.000000"),
        realized_pnl=Decimal("0.00"),
        realized_pnl_pct=Decimal("0"),
        executed_at=datetime(2026, 10, 1, 8, 5, 0),
    )
    db_session.add(fill)
    db_session.commit()
    before = _counts(db_session, owner_id)

    def _forbid(*_args, **_kwargs):
        raise AssertionError("order detail called a provider, execution, cancel, or MFA path")

    for target in (
        "app.routers.orders.place_order",
        "app.routers.orders.cancel_order",
        "app.routers.orders.require_notional_step_up",
        "app.services.order_book.place_order",
        "app.services.order_book.cancel_order",
        "app.services.trade_execution.execute_fill",
        "app.services.mfa.consume_totp",
        "app.services.price_service.get_live_price",
        "app.services.price_service.get_stock_quote",
    ):
        monkeypatch.setattr(target, _forbid)

    seen = {"reads": 0, "clocks": 0}

    def _wrapped_read(db):
        seen["reads"] += 1
        return real_consistent_read(db)

    def _wrapped_clock(db):
        seen["clocks"] += 1
        real_snapshot_clock(db)
        return FIXED_CLOCK

    monkeypatch.setattr("app.routers.orders.consistent_read", _wrapped_read)
    monkeypatch.setattr("app.routers.orders.snapshot_clock", _wrapped_clock)

    def _guard(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        text = statement.decode() if isinstance(statement, (bytes, bytearray)) else str(statement)
        if WRITE_SQL.search(text):
            raise AssertionError("order detail issued a write")

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", _guard)
    try:
        response = client.get(DETAIL.format(order_id=order.id), headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", _guard)

    assert response.status_code == 200, response.text
    body = response.json()
    _assert_detail(
        body,
        order_id=order.id,
        read_at=FIXED_CLOCK_Z,
        total_fill_count=1,
        limit=50,
        has_more=False,
        next_after_id=None,
        quantity="1.000000",
        filled_quantity="1.000000",
        remaining_quantity="0.000000",
        limit_price="4.000000",
    )
    assert body["fills"][0]["notional"] == "4.00"
    assert body["fills"][0]["realized_pnl"] == "0.00"
    assert seen == {"reads": 1, "clocks": 1}
    assert _counts(db_session, owner_id) == before

    def _broken(_db):
        raise SnapshotClockError("snapshot clock is missing")

    monkeypatch.setattr("app.routers.orders.snapshot_clock", _broken)
    with pytest.raises(SnapshotClockError, match="snapshot clock is missing"):
        client.get(DETAIL.format(order_id=order.id), headers=headers)
    assert _counts(db_session, owner_id) == before
