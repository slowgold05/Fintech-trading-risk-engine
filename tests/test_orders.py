from decimal import Decimal
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.models.market_symbol import MarketSymbol
from app.models.market_quote_cache import MarketQuoteCache
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import User
from app.services.ledger_service import reconcile_account
from app.core.config import settings
from app.services.pretrade_controls import check_open_order_price_bands


def _order(client, headers, side, quantity, price):
    return client.post("/orders/", headers={**headers, "Idempotency-Key": str(uuid4())},
                       json={"symbol": "AAPL", "side": side, "quantity": quantity, "limit_price": price})


def _trade(client, headers, payload):
    return client.post("/trades/", headers={**headers, "Idempotency-Key": str(uuid4())}, json=payload)


def _seed(db):
    db.add(MarketSymbol(symbol="AAPL", company_name="Apple", exchange="NASDAQ", is_active=True))
    db.flush()
    db.add(MarketQuoteCache(symbol="AAPL", price=100, change_amount=0, change_percent=0, volume=0,
                            source="yahoo", quote_at=datetime.now(timezone.utc).replace(tzinfo=None)))
    db.commit()


def test_price_time_priority_partial_fill_and_ledger(client, auth_headers, db_session):
    _seed(db_session)
    seller1 = auth_headers("seller1@example.com")
    seller2 = auth_headers("seller2@example.com")
    buyer = auth_headers("buyer@example.com")
    for headers in (seller1, seller2):
        assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 2}).status_code == 200

    ask1 = _order(client, seller1, "sell", 2, 90)
    ask2 = _order(client, seller2, "sell", 2, 90)
    assert ask1.status_code == ask2.status_code == 200
    bid = _order(client, buyer, "buy", 3, 95)
    assert bid.status_code == 200, bid.text
    assert bid.json()["status"] == "filled"
    assert len(bid.json()["trade_ids"]) == 4
    orders = {order.id: order for order in db_session.query(Order).all()}
    assert orders[ask1.json()["id"]].status == "filled"
    assert orders[ask2.json()["id"]].remaining_quantity == Decimal("1")
    trades = db_session.query(Trade).filter(Trade.order_id == bid.json()["id"]).order_by(Trade.id).all()
    assert [(trade.quantity, trade.price_at_execution) for trade in trades] == [(Decimal("2"), Decimal("90")), (Decimal("1"), Decimal("90"))]
    for user in db_session.query(User).all():
        assert reconcile_account(db_session, user)["ok"]


def test_reservations_cancel_and_reset(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(settings, "max_stock_concentration_pct", Decimal("100"))
    _seed(db_session)
    headers = auth_headers()
    buy = _order(client, headers, "buy", 1000, 90)
    assert buy.status_code == 200, buy.text
    assert client.get("/portfolio/", headers=headers).json()["summary"]["buying_power"] == 10000
    blocked = _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 101})
    assert blocked.status_code == 400
    assert _order(client, headers, "buy", 200, 90).status_code == 400
    assert client.post("/portfolio/reset", headers=headers).status_code == 400
    assert client.post(f"/orders/{buy.json()['id']}/cancel", headers=headers).status_code == 200
    assert client.get("/portfolio/", headers=headers).json()["summary"]["buying_power"] == 100000
    assert client.post("/portfolio/reset", headers=headers).status_code == 200

    assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 2}).status_code == 200
    sell = _order(client, headers, "sell", 1.5, 110)
    assert sell.status_code == 200, sell.text
    assert _order(client, headers, "sell", 1, 110).status_code == 400
    assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "sell", "quantity": 1}).status_code == 400
    assert client.post(f"/orders/{sell.json()['id']}/cancel", headers=headers).status_code == 200
    assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "sell", "quantity": 1}).status_code == 200


def test_self_trade_is_not_matched_and_unknown_symbol_rejected(client, auth_headers, db_session):
    _seed(db_session)
    headers = auth_headers()
    assert client.post("/orders/", headers={**headers, "Idempotency-Key": str(uuid4())}, json={"symbol": "FAKE", "side": "buy", "quantity": 1, "limit_price": 10}).status_code == 400
    assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 1}).status_code == 200
    assert _order(client, headers, "sell", 1, 90).status_code == 200
    bid = _order(client, headers, "buy", 1, 100)
    assert bid.status_code == 200
    assert bid.json()["trade_ids"] == []
    assert len(client.get("/orders/", headers=headers).json()["orders"]) == 2
    book = client.get("/orders/book/aapl", headers=headers).json()
    assert book["bids"] == [{"price": 100.0, "quantity": 1.0}]
    assert book["asks"] == [{"price": 90.0, "quantity": 1.0}]
    assert "user_id" not in str(book)


def test_zero_cent_fill_is_rejected(client, auth_headers, db_session):
    _seed(db_session)
    headers = auth_headers()
    response = _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 0.000001})
    assert response.status_code == 400
    assert response.json()["detail"] == "Trade value must be at least $0.01"
    assert _order(client, headers, "buy", 0.000001, 0.000001).status_code == 422


def test_market_order_fills_immediately_and_cancels_remainder(client, auth_headers, db_session):
    _seed(db_session)
    seller = auth_headers("market-seller@example.com")
    buyer = auth_headers("market-buyer@example.com")
    assert _trade(client, seller, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 2}).status_code == 200
    assert _order(client, seller, "sell", 2, 105).status_code == 200
    market = client.post("/orders/", headers={**buyer, "Idempotency-Key": str(uuid4())}, json={"symbol": "AAPL", "side": "buy", "order_type": "market", "quantity": 3})
    assert market.status_code == 200, market.text
    assert market.json()["status"] == "canceled"
    assert market.json()["remaining_quantity"] == 1.0
    assert len(market.json()["trade_ids"]) == 2
    assert market.json()["limit_price"] is None
    assert client.get("/orders/book/AAPL", headers=buyer).json() == {"symbol": "AAPL", "bids": [], "asks": []}
    assert client.post("/orders/", headers={**buyer, "Idempotency-Key": str(uuid4())}, json={"symbol": "AAPL", "side": "buy", "order_type": "market", "quantity": 1, "limit_price": 100}).status_code == 422
    for user in db_session.query(User).all():
        assert reconcile_account(db_session, user)["ok"]


def test_best_price_wins_and_only_owner_can_cancel(client, auth_headers, db_session):
    _seed(db_session)
    expensive = auth_headers("expensive@example.com")
    cheap = auth_headers("cheap@example.com")
    buyer = auth_headers("price-buyer@example.com")
    for headers in (expensive, cheap):
        assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 1}).status_code == 200
    first = _order(client, expensive, "sell", 1, 95).json()
    second = _order(client, cheap, "sell", 1, 90).json()
    assert client.post(f"/orders/{second['id']}/cancel", headers=buyer).status_code == 404
    result = _order(client, buyer, "buy", 1, 100)
    assert result.status_code == 200, result.text
    assert db_session.query(Order).filter(Order.id == first["id"]).one().status == "open"
    assert db_session.query(Order).filter(Order.id == second["id"]).one().status == "filled"
    assert db_session.query(Trade).filter(Trade.order_id == result.json()["id"]).one().price_at_execution == Decimal("90")


def test_oversized_notional_is_rejected_without_decimal_error(client, auth_headers, db_session, monkeypatch):
    _seed(db_session)
    headers = auth_headers()
    order = _order(client, headers, "buy", "999999999999.999999", "999999999999.999999")
    assert order.status_code == 400, order.text
    monkeypatch.setattr("app.routers.trades.get_live_price", lambda symbol, asset_type: "999999999999.999999")
    trade = _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": "999999999999.999999"})
    assert trade.status_code == 400, trade.text


def test_split_fill_rounding_cannot_spend_other_order_reservation(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(settings, "max_stock_concentration_pct", Decimal("100"))
    _seed(db_session)
    db_session.add(MarketSymbol(symbol="MSFT", company_name="Microsoft", exchange="NASDAQ", is_active=True))
    db_session.flush()
    db_session.add(MarketQuoteCache(symbol="MSFT", price=99999.99, change_amount=0, change_percent=0,
                                    volume=0, source="yahoo", quote_at=datetime.now(timezone.utc).replace(tzinfo=None)))
    db_session.get(MarketQuoteCache, "AAPL").price = 5000
    db_session.commit()
    sellers = [auth_headers(f"rounding-{i}@example.com") for i in range(2)]
    buyer = auth_headers("rounding-buyer@example.com")
    for headers in sellers:
        assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 0.0001}).status_code == 200
        assert _order(client, headers, "sell", "0.000001", 5000).status_code == 200
    reserve = client.post("/orders/", headers={**buyer, "Idempotency-Key": str(uuid4())}, json={"symbol": "MSFT", "side": "buy", "quantity": 1, "limit_price": 99999.99})
    assert reserve.status_code == 200, reserve.text
    crossing = _order(client, buyer, "buy", "0.000002", 5000)
    assert crossing.status_code == 400, crossing.text
    assert db_session.query(Trade).filter(Trade.order_id.is_not(None)).count() == 0


def test_kill_switch_blocks_new_trading_but_allows_cancellation(client, auth_headers, db_session, monkeypatch):
    _seed(db_session)
    headers = auth_headers()
    order = _order(client, headers, "buy", 1, 90)
    assert order.status_code == 200
    monkeypatch.setattr(settings, "trading_halted", True)
    assert _order(client, headers, "buy", 1, 90).status_code == 503
    assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 1}).status_code == 503
    assert client.post(f"/orders/{order.json()['id']}/cancel", headers=headers).status_code == 200
    assert db_session.query(Order).count() == 1


def test_price_band_rejects_fat_finger_and_unusable_quotes(client, auth_headers, db_session):
    _seed(db_session)
    headers = auth_headers()
    assert _order(client, headers, "buy", 1, 80).status_code == 200
    assert _order(client, headers, "buy", 1, 120).status_code == 200
    outside = _order(client, headers, "buy", 1, 120.01)
    assert outside.status_code == 400
    assert "SM-PT-02" in outside.json()["detail"]
    quote = db_session.get(MarketQuoteCache, "AAPL")
    quote.quote_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=8)
    db_session.commit()
    stale = _order(client, headers, "buy", 1, 100)
    assert stale.status_code == 503
    assert "SM-PT-02" in stale.json()["detail"]
    assert db_session.query(Order).count() == 2
    result = check_open_order_price_bands(db_session)
    assert result["checked"] == result["violation_count"] == 2


def test_concentration_counts_open_buys_and_existing_holdings(client, auth_headers, db_session):
    _seed(db_session)
    headers = auth_headers()
    first = _order(client, headers, "buy", 500, 100)
    assert first.status_code == 200
    blocked = _order(client, headers, "buy", 1, 100)
    assert blocked.status_code == 400
    assert "SM-PT-03" in blocked.json()["detail"]
    assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 1}).status_code == 400
    assert client.post(f"/orders/{first.json()['id']}/cancel", headers=headers).status_code == 200
    assert _order(client, headers, "buy", 500, 120).status_code == 400
    assert _trade(client, headers, {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 500}).status_code == 200
    assert _order(client, headers, "buy", 1, 100).status_code == 400


def test_order_idempotency_replays_original_result_and_rejects_key_reuse(client, auth_headers, db_session):
    _seed(db_session)
    headers = {**auth_headers(), "Idempotency-Key": "same-order-request"}
    payload = {"symbol": "AAPL", "side": "buy", "quantity": 1, "limit_price": 90}
    first = client.post("/orders/", headers=headers, json=payload)
    assert first.status_code == 200, first.text
    assert client.post(f"/orders/{first.json()['id']}/cancel", headers=headers).status_code == 200
    replay = client.post("/orders/", headers=headers, json=payload)
    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert db_session.query(Order).count() == 1
    conflict = client.post("/orders/", headers=headers, json={**payload, "quantity": 2})
    assert conflict.status_code == 409
    assert db_session.query(Order).count() == 1
    other_headers = {**auth_headers("other-idempotency-user@example.com"), "Idempotency-Key": headers["Idempotency-Key"]}
    assert client.post("/orders/", headers=other_headers, json=payload).status_code == 200
    assert db_session.query(Order).count() == 2
    assert client.post("/orders/", headers={"Authorization": headers["Authorization"]}, json=payload).status_code == 422
