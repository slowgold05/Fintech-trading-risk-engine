"""One trader journey from search through portfolio. Seeded rows only; no provider."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from app.models.aml import CashMovement
from app.models.holding import Holding
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade
from app.services.exchange_calendar import is_nyse_trading_day

# Quote, opening fill, and the crossing limit are the same price. The local
# test client prices an unknown symbol at 100, and the reference band is 20%.
QUOTE_PRICE = 100
MATCH_LIMIT = 100
# Inside the band (80 through 120) and below the resting ask, so the buy is accepted and does not cross.
RESTING_LIMIT = 85
FILL_QUANTITY = 1
SELLER_OPENING_QUANTITY = 2
PRICE_QUANTUM = Decimal("0.000001")


def _recent_nyse_sessions(count: int) -> list:
    """Consecutive NYSE sessions ending on or before today's UTC date, oldest first."""
    day = datetime.now(timezone.utc).date()
    found = []
    while len(found) < count:
        if is_nyse_trading_day(day):
            found.append(day)
        day -= timedelta(days=1)
    found.reverse()
    return found


def _ledger_counts(db) -> tuple[int, int, int, int]:
    return (
        db.query(Order).count(),
        db.query(Trade).count(),
        db.query(CashMovement).count(),
        db.query(Holding).count(),
    )


def _position(body: dict, symbol: str) -> dict:
    matches = [row for row in body["positions"] if row["symbol"] == symbol]
    assert len(matches) == 1
    return matches[0]


def test_full_trader_journey_search_to_portfolio(client, auth_headers, db_session):
    closes = [
        Decimal("101.000000"),
        Decimal("102.000000"),
        Decimal("103.000000"),
        Decimal("104.000000"),
        Decimal("105.000000"),
    ]
    fetched_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db_session.add(MarketSymbol(
        symbol="SNA",
        company_name="SNA",
        exchange="NYSE",
        sector=None,
        is_etf=False,
        is_test=False,
        is_active=True,
        refresh_tier="daily",
    ))
    db_session.flush()
    for session_date, close_price in zip(_recent_nyse_sessions(len(closes)), closes):
        db_session.add(MarketBarDaily(
            symbol="SNA",
            session_date=session_date,
            provider="yahoo",
            adjustment_type="raw",
            open=close_price,
            high=close_price,
            low=close_price,
            close=close_price,
            volume=100,
            fetched_at=fetched_at,
            quality_status="valid",
        ))
    db_session.add(MarketQuoteCache(
        symbol="SNA",
        price=QUOTE_PRICE,
        change_amount=0,
        change_percent=0,
        volume=0,
        source="yahoo",
        quote_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ))
    db_session.commit()

    buyer = auth_headers("journey-buyer@example.com", "password123")
    seller = auth_headers("journey-seller@example.com", "password123")

    search = client.get("/market/universe", headers=buyer, params={"search": "SNA"})
    assert search.status_code == 200, search.text
    assert any(item["symbol"] == "SNA" for item in search.json()["items"])

    history = client.get(
        "/market/symbols/SNA/history",
        headers=buyer,
        params={
            "interval": "1d",
            "range": "2y",
            "provider": "yahoo",
            "adjustment_type": "raw",
        },
    )
    assert history.status_code == 200, history.text
    bars = history.json()["bars"]
    assert bars
    expected_closes = [format(price.quantize(PRICE_QUANTUM), "f") for price in closes]
    assert [bar["close"] for bar in bars] == expected_closes

    buy_payload = {"symbol": "SNA", "side": "buy", "quantity": FILL_QUANTITY, "limit_price": MATCH_LIMIT}
    before_preview = _ledger_counts(db_session)
    preview = client.post("/orders/preview", headers=buyer, json=buy_payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["status"] == "eligible"
    assert _ledger_counts(db_session) == before_preview

    # A limit sell is rejected with no holding. Order tests open that position with POST /trades/ first.
    opened = client.post(
        "/trades/",
        headers={**seller, "Idempotency-Key": str(uuid4())},
        json={
            "symbol": "SNA",
            "asset_type": "stock",
            "side": "buy",
            "quantity": SELLER_OPENING_QUANTITY,
        },
    )
    assert opened.status_code == 200, opened.text

    sell = client.post(
        "/orders/",
        headers={**seller, "Idempotency-Key": str(uuid4())},
        json={"symbol": "SNA", "side": "sell", "quantity": FILL_QUANTITY, "limit_price": MATCH_LIMIT},
    )
    assert sell.status_code == 200, sell.text
    sell_order_id = sell.json()["id"]

    buy = client.post(
        "/orders/",
        headers={**buyer, "Idempotency-Key": str(uuid4())},
        json=buy_payload,
    )
    assert buy.status_code == 200, buy.text
    assert buy.json()["trade_ids"]
    buy_order_id = buy.json()["id"]

    buyer_order = client.get(f"/orders/{buy_order_id}", headers=buyer)
    seller_order = client.get(f"/orders/{sell_order_id}", headers=seller)
    assert buyer_order.status_code == 200, buyer_order.text
    assert seller_order.status_code == 200, seller_order.text
    assert buyer_order.json()["status"] == "filled"
    assert seller_order.json()["status"] == "filled"

    resting = client.post(
        "/orders/",
        headers={**buyer, "Idempotency-Key": str(uuid4())},
        json={"symbol": "SNA", "side": "buy", "quantity": FILL_QUANTITY, "limit_price": RESTING_LIMIT},
    )
    assert resting.status_code == 200, resting.text
    resting_id = resting.json()["id"]
    assert resting.json()["trade_ids"] == []
    while_open = client.get("/portfolio/", headers=buyer)
    assert while_open.status_code == 200, while_open.text
    buying_power_while_open = while_open.json()["summary"]["buying_power"]

    canceled = client.post(f"/orders/{resting_id}/cancel", headers=buyer)
    assert canceled.status_code == 200, canceled.text
    canceled_order = client.get(f"/orders/{resting_id}", headers=buyer)
    assert canceled_order.status_code == 200, canceled_order.text
    assert canceled_order.json()["status"] == "canceled"
    after_cancel = client.get("/portfolio/", headers=buyer)
    assert after_cancel.status_code == 200, after_cancel.text
    released = Decimal(str(after_cancel.json()["summary"]["buying_power"])) - Decimal(str(buying_power_while_open))
    assert released == Decimal(FILL_QUANTITY) * Decimal(RESTING_LIMIT)

    buyer_portfolio = after_cancel.json()
    buyer_position = _position(buyer_portfolio, "SNA")
    assert buyer_position["quantity"] == FILL_QUANTITY
    assert buyer_position["avg_cost"] == MATCH_LIMIT

    buyer_trades = client.get("/trades/", headers=buyer)
    assert buyer_trades.status_code == 200, buyer_trades.text
    matched = [row for row in buyer_trades.json()["trades"] if row["symbol"] == "SNA"]
    assert len(matched) == 1
    assert matched[0]["side"] == "buy"
    assert matched[0]["quantity"] == FILL_QUANTITY
    assert matched[0]["price_at_execution"] == MATCH_LIMIT
    assert matched[0]["notional"] == FILL_QUANTITY * MATCH_LIMIT

    seller_portfolio = client.get("/portfolio/", headers=seller)
    assert seller_portfolio.status_code == 200, seller_portfolio.text
    seller_position = _position(seller_portfolio.json(), "SNA")
    assert seller_position["quantity"] == SELLER_OPENING_QUANTITY - FILL_QUANTITY
    assert seller_position["avg_cost"] == QUOTE_PRICE


def test_journey_partial_fill_rejection_and_duplicate_resubmission(client, auth_headers, db_session):
    symbol = "NDSN"
    seller_qty = 3
    resting_sell_qty = 2
    buyer_market_qty = 5
    closes = [
        Decimal("101.000000"),
        Decimal("102.000000"),
        Decimal("103.000000"),
        Decimal("104.000000"),
        Decimal("105.000000"),
    ]
    fetched_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db_session.add(MarketSymbol(
        symbol=symbol,
        company_name=symbol,
        exchange="NYSE",
        sector=None,
        is_etf=False,
        is_test=False,
        is_active=True,
        refresh_tier="daily",
    ))
    db_session.flush()
    for session_date, close_price in zip(_recent_nyse_sessions(len(closes)), closes):
        db_session.add(MarketBarDaily(
            symbol=symbol,
            session_date=session_date,
            provider="yahoo",
            adjustment_type="raw",
            open=close_price,
            high=close_price,
            low=close_price,
            close=close_price,
            volume=100,
            fetched_at=fetched_at,
            quality_status="valid",
        ))
    db_session.add(MarketQuoteCache(
        symbol=symbol,
        price=QUOTE_PRICE,
        change_amount=0,
        change_percent=0,
        volume=0,
        source="yahoo",
        quote_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ))
    db_session.commit()

    buyer = auth_headers("journey2-buyer@example.com", "password123")
    seller = auth_headers("journey2-seller@example.com", "password123")

    opened = client.post(
        "/trades/",
        headers={**seller, "Idempotency-Key": str(uuid4())},
        json={
            "symbol": symbol,
            "asset_type": "stock",
            "side": "buy",
            "quantity": seller_qty,
        },
    )
    assert opened.status_code == 200, opened.text

    resting_sell = client.post(
        "/orders/",
        headers={**seller, "Idempotency-Key": str(uuid4())},
        json={"symbol": symbol, "side": "sell", "quantity": resting_sell_qty, "limit_price": MATCH_LIMIT},
    )
    assert resting_sell.status_code == 200, resting_sell.text

    market = client.post(
        "/orders/",
        headers={**buyer, "Idempotency-Key": str(uuid4())},
        json={"symbol": symbol, "side": "buy", "order_type": "market", "quantity": buyer_market_qty},
    )
    assert market.status_code == 200, market.text
    market_body = market.json()
    assert market_body["status"] == "canceled"
    assert market_body["trade_ids"]
    assert len(market_body["trade_ids"]) == 2
    assert market_body["remaining_quantity"] == buyer_market_qty - resting_sell_qty

    persisted = client.get(f"/orders/{market_body['id']}", headers=buyer)
    assert persisted.status_code == 200, persisted.text
    persisted_body = persisted.json()
    assert persisted_body["status"] == "canceled"
    assert Decimal(persisted_body["remaining_quantity"]) == Decimal(buyer_market_qty - resting_sell_qty)
    assert [fill["trade_id"] for fill in persisted_body["fills"]] == [market_body["trade_ids"][0]]

    buyer_portfolio = client.get("/portfolio/", headers=buyer)
    assert buyer_portfolio.status_code == 200, buyer_portfolio.text
    assert _position(buyer_portfolio.json(), symbol)["quantity"] == resting_sell_qty

    buying_power = Decimal(str(buyer_portfolio.json()["summary"]["buying_power"]))
    limit_price = Decimal(MATCH_LIMIT)
    oversized_qty = int(buying_power // limit_price) + 1
    assert Decimal(oversized_qty) * limit_price > buying_power
    rejected = client.post(
        "/orders/",
        headers={**buyer, "Idempotency-Key": str(uuid4())},
        json={"symbol": symbol, "side": "buy", "quantity": oversized_qty, "limit_price": MATCH_LIMIT},
    )
    assert rejected.status_code == 400, rejected.text
    assert "Insufficient buying power" in rejected.text
    after_reject = client.get("/portfolio/", headers=buyer)
    assert after_reject.status_code == 200, after_reject.text
    assert Decimal(str(after_reject.json()["summary"]["buying_power"])) == buying_power

    duplicate_key = str(uuid4())
    duplicate_payload = {"symbol": symbol, "side": "buy", "quantity": 1, "limit_price": MATCH_LIMIT}
    first = client.post(
        "/orders/",
        headers={**buyer, "Idempotency-Key": duplicate_key},
        json=duplicate_payload,
    )
    assert first.status_code == 200, first.text
    order_count = db_session.query(Order).count()
    trade_count = db_session.query(Trade).count()
    second = client.post(
        "/orders/",
        headers={**buyer, "Idempotency-Key": duplicate_key},
        json=duplicate_payload,
    )
    assert second.status_code == first.status_code
    assert second.json() == first.json()
    assert db_session.query(Order).count() == order_count
    assert db_session.query(Trade).count() == trade_count
