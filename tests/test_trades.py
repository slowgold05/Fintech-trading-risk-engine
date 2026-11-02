import pytest
from uuid import uuid4
from sqlalchemy import text

from app.models.holding import Holding
from app.models.lot import Lot
from app.models.trade import Trade
from app.models.user import User
from app.services.idempotency_check import check_idempotency_records


def create_trade(client, headers, symbol="AAPL", side="buy", quantity=1):
    return client.post(
        "/trades/",
        headers={**headers, "Idempotency-Key": str(uuid4())},
        json={
            "symbol": symbol,
            "asset_type": "stock",
            "side": side,
            "quantity": quantity,
        },
    )


def test_buy_creates_holding_lot_and_deducts_cash(client, auth_headers, db_session):
    headers = auth_headers()

    response = create_trade(client, headers, quantity=3)

    assert response.status_code == 200, response.text
    holding = db_session.query(Holding).one()
    lot = db_session.query(Lot).one()
    user = db_session.query(User).one()

    assert float(holding.quantity) == 3
    assert float(holding.avg_cost) == 100
    assert lot.qty_remaining == 3
    assert lot.cost_per_unit == 100
    assert float(user.cash_balance) == 99700


def test_fifo_sell_across_two_lots_computes_realized_pnl(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    headers = auth_headers()
    prices = iter([100.0, 120.0, 150.0])
    monkeypatch.setattr("app.routers.trades.get_live_price", lambda symbol, asset_type: next(prices))

    assert create_trade(client, headers, quantity=1).status_code == 200
    assert create_trade(client, headers, quantity=1).status_code == 200
    sell = create_trade(client, headers, side="sell", quantity=1.5)

    assert sell.status_code == 200, sell.text
    sell_trade = db_session.query(Trade).filter(Trade.side == "sell").one()
    holding = db_session.query(Holding).one()
    lots = db_session.query(Lot).order_by(Lot.id).all()
    user = db_session.query(User).one()

    assert sell_trade.realized_pnl == pytest.approx(65.0)
    assert sell_trade.realized_pnl_pct == pytest.approx(40.625)
    assert float(holding.quantity) == pytest.approx(0.5)
    assert float(holding.avg_cost) == pytest.approx(120.0)
    assert lots[0].qty_remaining == 0
    assert lots[1].qty_remaining == pytest.approx(0.5)
    assert float(user.cash_balance) == pytest.approx(100005.0)


def test_oversell_is_rejected(client, auth_headers):
    headers = auth_headers()
    assert create_trade(client, headers, quantity=1).status_code == 200

    response = create_trade(client, headers, side="sell", quantity=2)

    assert response.status_code == 400
    assert response.json()["detail"] == "Not enough holdings to sell"


def test_buy_rejected_when_cash_is_insufficient(client, auth_headers):
    headers = auth_headers()

    response = create_trade(client, headers, symbol="TSLA", quantity=101)

    assert response.status_code == 400
    assert response.json()["detail"] == "Insufficient buying power"


def test_fractional_trade_uses_decimal_rounding(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers()
    prices = iter([0.10, 0.30])
    monkeypatch.setattr("app.routers.trades.get_live_price", lambda symbol, asset_type: next(prices))

    assert create_trade(client, headers, quantity=3).status_code == 200
    assert create_trade(client, headers, side="sell", quantity=2).status_code == 200
    user = db_session.query(User).one()
    trade = db_session.query(Trade).filter(Trade.side == "sell").one()
    assert str(user.cash_balance) == "100000.30"
    assert str(trade.realized_pnl) == "0.40"

    monkeypatch.setattr("app.routers.portfolio.get_live_price", lambda symbol, asset_type: 0.30)
    summary = client.get("/portfolio/", headers=headers).json()["summary"]
    assert summary["total_portfolio_value"] == 0.30
    assert summary["total_account_value"] == 100000.60
    assert summary["total_realized_pnl"] == 0.40
    assert summary["total_unrealized_pnl"] == 0.20


def test_quantity_beyond_six_decimal_places_is_rejected(client, auth_headers):
    response = create_trade(client, auth_headers(), quantity=0.0000001)
    assert response.status_code == 422


def test_trade_retry_returns_original_fill_without_second_trade(client, auth_headers, db_session):
    headers = {**auth_headers(), "Idempotency-Key": "same-direct-trade"}
    payload = {"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 1}
    first = client.post("/trades/", headers=headers, json=payload)
    assert first.status_code == 200, first.text
    replay = client.post("/trades/", headers=headers, json=payload)
    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert db_session.query(Trade).count() == 1
    assert client.post("/trades/", headers=headers, json={**payload, "quantity": 2}).status_code == 409
    assert db_session.query(Trade).count() == 1
    assert client.post("/trades/", headers={"Authorization": headers["Authorization"]}, json=payload).status_code == 422
    assert check_idempotency_records(db_session) == {"checked": 1, "unique_constraint": True,
                                                     "violation_count": 0, "incomplete_count": 0}
    db_session.execute(text("UPDATE order_requests SET response = NULL"))
    db_session.commit()
    assert check_idempotency_records(db_session)["violation_count"] == 1
