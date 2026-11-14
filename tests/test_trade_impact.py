"""POST /portfolio/trade-impact previews one trade and does not write."""

from decimal import Decimal

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.market_quote_cache import MarketQuoteCache
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import User
from tests.test_portfolio_allocation import _add_position, _add_quote, _add_symbol, _forbid_providers


def _seed_reference_book(db_session, email):
    user = db_session.query(User).filter(User.email == email).one()
    user.cash_balance = Decimal("1000.00")
    _add_position(db_session, user, "AAPL", "stock", Decimal("3"), Decimal("10"))
    _add_position(db_session, user, "JPM", "stock", Decimal("2"), Decimal("10"))
    _add_position(db_session, user, "XOM", "stock", Decimal("1"), Decimal("10"))
    for symbol in ("AAPL", "JPM", "XOM"):
        _add_symbol(db_session, symbol)
        _add_quote(db_session, symbol, Decimal("100"))
    db_session.commit()
    return user


def _book_fingerprint(db_session, user_id):
    db_session.expire_all()
    user = db_session.query(User).filter(User.id == user_id).one()
    holdings = (
        db_session.query(Asset.symbol, Holding.quantity, Holding.avg_cost)
        .join(Asset, Asset.id == Holding.asset_id)
        .filter(Holding.user_id == user_id)
        .order_by(Asset.symbol)
        .all()
    )
    return {
        "cash": user.cash_balance,
        "orders": db_session.query(Order).filter(Order.user_id == user_id).count(),
        "trades": db_session.query(Trade).filter(Trade.user_id == user_id).count(),
        "holdings": [(row.symbol, row.quantity, row.avg_cost) for row in holdings],
        "ledger": db_session.query(LedgerEntry).filter(LedgerEntry.user_id == user_id).count(),
    }


def test_buy_reference_vector_matches_the_contract(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("impact-buy@example.com")
    user = _seed_reference_book(db_session, "impact-buy@example.com")
    before_book = _book_fingerprint(db_session, user.id)

    response = client.post(
        "/portfolio/trade-impact",
        headers=headers,
        json={
            "symbol": "AAPL",
            "side": "buy",
            "quantity": "2",
            "reference_price": "100.000000",
            "order_type": "market",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["warnings"] == []
    assert body["symbol"] == "AAPL"
    assert body["side"] == "buy"
    assert body["quantity"] == "2.000000"
    assert body["reference_price"] == "100.000000"
    assert body["order_type"] == "market"
    assert body["read_at"].endswith("Z")
    assert body["user"]["email"] == "impact-buy@example.com"
    assert body["before"] == {
        "cash_balance": "1000.00",
        "buying_power": "1000.00",
        "total_account_value": "1600.00",
        "cash_weight_pct": "62.5000",
        "symbol_position_value": "300.00",
        "symbol_weight_pct": "18.7500",
    }
    assert body["after"] == {
        "cash_balance": "800.00",
        "buying_power": "800.00",
        "total_account_value": "1600.00",
        "cash_weight_pct": "50.0000",
        "symbol_position_value": "500.00",
        "symbol_weight_pct": "31.2500",
    }
    assert body["changes"] == {
        "cash_balance": "-200.00",
        "total_account_value": "0.00",
        "cash_weight_pct": "-12.5000",
        "symbol_weight_pct": "12.5000",
    }
    assert Decimal(body["after"]["total_account_value"]) == Decimal(body["before"]["total_account_value"])

    after_book = _book_fingerprint(db_session, user.id)
    assert after_book == before_book
    assert after_book["cash"] == Decimal("1000.00")
    assert after_book["orders"] == 0
    assert after_book["trades"] == 0


def test_sell_reference_vector_matches_the_contract(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("impact-sell@example.com")
    _seed_reference_book(db_session, "impact-sell@example.com")

    response = client.post(
        "/portfolio/trade-impact",
        headers=headers,
        json={"symbol": "AAPL", "side": "sell", "quantity": "1", "reference_price": "100.000000"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["warnings"] == []
    assert body["order_type"] == "market"
    assert body["after"]["cash_balance"] == "1100.00"
    assert body["after"]["buying_power"] == "1100.00"
    assert body["after"]["symbol_position_value"] == "200.00"
    assert body["after"]["symbol_weight_pct"] == "12.5000"
    assert body["after"]["cash_weight_pct"] == "68.7500"
    assert body["after"]["total_account_value"] == "1600.00"
    assert body["changes"]["total_account_value"] == "0.00"
    assert Decimal(body["after"]["total_account_value"]) == Decimal(body["before"]["total_account_value"])


def test_insufficient_buying_power_warning_fires_without_rejecting(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("impact-bp@example.com")
    _seed_reference_book(db_session, "impact-bp@example.com")

    response = client.post(
        "/portfolio/trade-impact",
        headers=headers,
        json={
            "symbol": "AAPL",
            "side": "buy",
            "quantity": "100",
            "reference_price": "100.000000",
            "order_type": "market",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["warnings"] == ["insufficient_buying_power"]
    assert body["before"]["cash_balance"] == "1000.00"
    assert body["before"]["total_account_value"] == "1600.00"
    assert body["after"]["cash_balance"] == "-9000.00"
    assert body["after"]["buying_power"] == "-9000.00"
    assert body["after"]["symbol_position_value"] == "10300.00"
    assert body["after"]["total_account_value"] == "1600.00"
    assert body["after"]["cash_weight_pct"] == "-562.5000"
    assert body["after"]["symbol_weight_pct"] == "643.7500"
    assert body["changes"] == {
        "cash_balance": "-10000.00",
        "total_account_value": "0.00",
        "cash_weight_pct": "-625.0000",
        "symbol_weight_pct": "625.0000",
    }
    assert Decimal(body["after"]["cash_balance"]) < 0


def test_insufficient_shares_warning_fires_without_rejecting(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("impact-shares@example.com")
    _seed_reference_book(db_session, "impact-shares@example.com")

    response = client.post(
        "/portfolio/trade-impact",
        headers=headers,
        json={"symbol": "AAPL", "side": "sell", "quantity": "10", "reference_price": "100.000000"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["warnings"] == ["insufficient_shares"]
    assert Decimal(body["after"]["symbol_position_value"]).is_finite()
    assert Decimal(body["after"]["cash_balance"]).is_finite()
    assert Decimal(body["changes"]["cash_balance"]).is_finite()
    assert body["changes"]["total_account_value"] == "0.00"


def test_status_is_incomplete_when_another_holding_is_unpriced(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("impact-incomplete@example.com")
    _seed_reference_book(db_session, "impact-incomplete@example.com")
    # Same book as the buy reference, except JPM has no quote.
    db_session.query(MarketQuoteCache).filter(MarketQuoteCache.symbol == "JPM").delete()
    db_session.commit()

    response = client.post(
        "/portfolio/trade-impact",
        headers=headers,
        json={
            "symbol": "AAPL",
            "side": "buy",
            "quantity": "2",
            "reference_price": "100.000000",
            "order_type": "market",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "incomplete"
    assert body["warnings"] == []
    assert body["before"] == {
        "cash_balance": "1000.00",
        "buying_power": "1000.00",
        "total_account_value": None,
        "cash_weight_pct": None,
        "symbol_position_value": "300.00",
        "symbol_weight_pct": None,
    }
    assert body["after"] == {
        "cash_balance": "800.00",
        "buying_power": "800.00",
        "total_account_value": None,
        "cash_weight_pct": None,
        "symbol_position_value": "500.00",
        "symbol_weight_pct": None,
    }
    assert body["changes"] == {
        "cash_balance": "-200.00",
        "total_account_value": "0.00",
        "cash_weight_pct": None,
        "symbol_weight_pct": None,
    }


def test_rejects_authentication_and_invalid_request_shapes(client, auth_headers):
    payload = {"symbol": "AAPL", "side": "buy", "quantity": "1", "reference_price": "10.000000"}
    assert client.post("/portfolio/trade-impact", json=payload).status_code == 401

    headers = auth_headers("impact-invalid@example.com")
    rejected = [
        {**payload, "quantity": "0"},
        {**payload, "quantity": "-1"},
        {**payload, "reference_price": "0"},
        {**payload, "reference_price": "-5"},
        {**payload, "side": "short"},
        {**payload, "order_type": "stop"},
    ]
    for body in rejected:
        response = client.post("/portfolio/trade-impact", headers=headers, json=body)
        assert response.status_code == 422, body
