"""POST /risk/scenarios previews custom shocks and does not write."""

from decimal import Decimal

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
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


def _post(client, headers, shocks):
    return client.post("/risk/scenarios", headers=headers, json={"shocks": shocks})


def test_two_independent_shocks_reference_vector(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("scenarios-ref1@example.com")
    user = _seed_reference_book(db_session, "scenarios-ref1@example.com")
    before_book = _book_fingerprint(db_session, user.id)
    shocks = [
        {"target_type": "symbol", "target": "AAPL", "shock_pct": "-10.0000"},
        {"target_type": "sector", "target": "Energy", "shock_pct": "-20.0000"},
    ]

    response = _post(client, headers, shocks)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["user"]["email"] == "scenarios-ref1@example.com"
    assert body["read_at"].endswith("Z")
    assert body["shocks"] == shocks
    assert body["total_account_value_before"] == "1600.00"
    assert body["total_account_value_after"] == "1550.00"
    assert body["loss"] == "50.00"
    assert body["loss_pct"] == "3.1250"
    assert body["securities"] == [
        {
            "symbol": "AAPL",
            "sector": "Technology",
            "position_value_before": "300.00",
            "position_value_after": "270.00",
        },
        {
            "symbol": "JPM",
            "sector": "Financials",
            "position_value_before": "200.00",
            "position_value_after": "200.00",
        },
        {
            "symbol": "XOM",
            "sector": "Energy",
            "position_value_before": "100.00",
            "position_value_after": "80.00",
        },
    ]

    after_book = _book_fingerprint(db_session, user.id)
    assert after_book == before_book
    assert after_book["cash"] == Decimal("1000.00")
    assert after_book["orders"] == 0
    assert after_book["trades"] == 0


def test_combined_shocks_multiply_not_sum(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("scenarios-ref2@example.com")
    _seed_reference_book(db_session, "scenarios-ref2@example.com")
    shocks = [
        {"target_type": "symbol", "target": "AAPL", "shock_pct": "-10.0000"},
        {"target_type": "sector", "target": "Energy", "shock_pct": "-20.0000"},
        {"target_type": "sector", "target": "Technology", "shock_pct": "-5.0000"},
    ]

    response = _post(client, headers, shocks)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    by_symbol = {item["symbol"]: item for item in body["securities"]}
    assert by_symbol["AAPL"]["position_value_before"] == "300.00"
    assert by_symbol["AAPL"]["position_value_after"] == "256.50"
    assert by_symbol["JPM"]["position_value_after"] == "200.00"
    assert by_symbol["XOM"]["position_value_after"] == "80.00"
    assert body["total_account_value_before"] == "1600.00"
    assert body["total_account_value_after"] == "1536.50"
    assert body["loss"] == "63.50"
    assert body["loss_pct"] == "3.9688"


def test_status_is_incomplete_when_a_holding_is_unpriced(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("scenarios-incomplete@example.com")
    user = db_session.query(User).filter(User.email == "scenarios-incomplete@example.com").one()
    user.cash_balance = Decimal("1000.00")
    _add_position(db_session, user, "AAPL", "stock", Decimal("1"), Decimal("10"))
    _add_symbol(db_session, "AAPL")
    db_session.commit()
    shocks = [
        {"target_type": "symbol", "target": "AAPL", "shock_pct": "-10.0000"},
    ]

    response = _post(client, headers, shocks)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "incomplete"
    assert body["total_account_value_before"] is None
    assert body["total_account_value_after"] is None
    assert body["loss"] is None
    assert body["loss_pct"] is None
    assert body["securities"] == []
    assert body["shocks"] == shocks


def test_rejects_authentication_and_invalid_request_shapes(client, auth_headers):
    shocks = [
        {"target_type": "symbol", "target": "AAPL", "shock_pct": "-10.0000"},
    ]
    assert client.post("/risk/scenarios", json={"shocks": shocks}).status_code == 401

    headers = auth_headers("scenarios-invalid@example.com")
    valid = shocks[0]
    rejected = [
        {"shocks": []},
        {"shocks": [{**valid, "shock_pct": "-1.0000"} for _ in range(21)]},
        {"shocks": [{**valid, "shock_pct": "-100"}]},
        {"shocks": [{**valid, "shock_pct": "-100.0000"}]},
        {"shocks": [{**valid, "shock_pct": "-150"}]},
        {"shocks": [{**valid, "target_type": "market"}]},
        {"shocks": [{**valid, "target": ""}]},
        {"shocks": [{**valid, "target": "   "}]},
    ]
    for body in rejected:
        response = client.post("/risk/scenarios", headers=headers, json=body)
        assert response.status_code == 422, body


def test_a_gain_scenario_produces_a_negative_loss(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("scenarios-gain@example.com")
    _seed_reference_book(db_session, "scenarios-gain@example.com")
    shocks = [
        {"target_type": "symbol", "target": "AAPL", "shock_pct": "10.0000"},
    ]

    response = _post(client, headers, shocks)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    by_symbol = {item["symbol"]: item for item in body["securities"]}
    assert by_symbol["AAPL"]["position_value_after"] == "330.00"
    assert by_symbol["JPM"]["position_value_after"] == "200.00"
    assert by_symbol["XOM"]["position_value_after"] == "100.00"
    assert body["total_account_value_before"] == "1600.00"
    assert body["total_account_value_after"] == "1630.00"
    assert body["loss"] == "-30.00"
    assert Decimal(body["loss"]) < 0
    assert body["loss_pct"] == "-1.8750"
    assert Decimal(body["loss_pct"]) < 0
