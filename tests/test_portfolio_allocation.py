"""GET /portfolio/allocation weights cash, securities, and sectors from one valuation."""

from decimal import Decimal

from app.models.market_symbol import MarketSymbol
from app.models.user import User
from tests.test_portfolio_valuation import _add_position, _add_quote, _add_symbol, _forbid_providers


def test_three_sector_reference_vector(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("alloc@example.com")
    user = db_session.query(User).filter(User.email == "alloc@example.com").one()
    user.cash_balance = Decimal("1000.00")
    _add_position(db_session, user, "AAPL", "stock", Decimal("3"), Decimal("10"))
    _add_position(db_session, user, "JPM", "stock", Decimal("2"), Decimal("10"))
    _add_position(db_session, user, "XOM", "stock", Decimal("1"), Decimal("10"))
    # Stored sector stays null. infer_sector returns SECTOR_BY_SYMBOL before
    # that column, and that map is what classifies these three tickers.
    for symbol in ("AAPL", "JPM", "XOM"):
        _add_symbol(db_session, symbol)
        _add_quote(db_session, symbol, Decimal("100"))
    db_session.commit()

    response = client.get("/portfolio/allocation", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["read_at"].endswith("Z")
    assert body["user"]["email"] == "alloc@example.com"
    assert body["cash_balance"] == "1000.00"
    assert body["total_account_value"] == "1600.00"
    assert body["cash_weight_pct"] == "62.5000"
    assert body["unavailable_symbols"] == []
    assert db_session.query(MarketSymbol).filter(MarketSymbol.symbol == "AAPL").one().sector is None

    by_symbol = {item["symbol"]: item for item in body["securities"]}
    assert by_symbol["AAPL"]["sector"] == "Technology"
    assert by_symbol["AAPL"]["position_value"] == "300.00"
    assert by_symbol["AAPL"]["weight_pct"] == "18.7500"
    assert by_symbol["AAPL"]["price_status"] == "available"
    assert by_symbol["JPM"]["sector"] == "Financials"
    assert by_symbol["JPM"]["position_value"] == "200.00"
    assert by_symbol["JPM"]["weight_pct"] == "12.5000"
    assert by_symbol["XOM"]["sector"] == "Energy"
    assert by_symbol["XOM"]["position_value"] == "100.00"
    assert by_symbol["XOM"]["weight_pct"] == "6.2500"
    assert body["sectors"] == [
        {"sector": "Technology", "value": "300.00", "weight_pct": "18.7500"},
        {"sector": "Financials", "value": "200.00", "weight_pct": "12.5000"},
        {"sector": "Energy", "value": "100.00", "weight_pct": "6.2500"},
    ]

    reported = [Decimal(body["cash_weight_pct"])]
    reported.extend(Decimal(item["weight_pct"]) for item in body["securities"])
    assert sum(reported, Decimal("0")) == Decimal("100.0000")


def test_cash_only_account_is_one_hundred_percent_cash(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("cashonly@example.com")
    user = db_session.query(User).filter(User.email == "cashonly@example.com").one()
    user.cash_balance = Decimal("1000.00")
    db_session.commit()

    response = client.get("/portfolio/allocation", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["cash_balance"] == "1000.00"
    assert body["cash_weight_pct"] == "100.0000"
    assert body["total_account_value"] == "1000.00"
    assert body["securities"] == []
    assert body["sectors"] == []


def test_incomplete_valuation_nulls_every_weight(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("unpriced@example.com")
    user = db_session.query(User).filter(User.email == "unpriced@example.com").one()
    user.cash_balance = Decimal("1000.00")
    _add_position(db_session, user, "AAPL", "stock", Decimal("1"), Decimal("10"))
    _add_symbol(db_session, "AAPL")
    db_session.commit()

    response = client.get("/portfolio/allocation", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "incomplete"
    assert body["total_account_value"] is None
    assert body["cash_weight_pct"] is None
    assert body["sectors"] is None
    assert body["unavailable_symbols"] == ["AAPL"]
    assert body["cash_balance"] == "1000.00"
    assert len(body["securities"]) == 1
    security = body["securities"][0]
    assert security["symbol"] == "AAPL"
    assert security["price_status"] == "unavailable"
    assert security["position_value"] is None
    assert security["weight_pct"] is None
    assert security["sector"] == "Technology"


def test_unmapped_symbol_falls_back_to_other(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("unmapped@example.com")
    user = db_session.query(User).filter(User.email == "unmapped@example.com").one()
    user.cash_balance = Decimal("1000.00")
    _add_position(db_session, user, "ZZZZ", "stock", Decimal("1"), Decimal("10"))
    _add_quote(db_session, "ZZZZ", Decimal("50"))
    db_session.commit()
    assert db_session.query(MarketSymbol).filter(MarketSymbol.symbol == "ZZZZ").one_or_none() is None

    response = client.get("/portfolio/allocation", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert len(body["securities"]) == 1
    security = body["securities"][0]
    assert security["symbol"] == "ZZZZ"
    assert security["sector"] == "Other"
    assert security["position_value"] == "50.00"
    assert body["sectors"] == [
        {
            "sector": "Other",
            "value": "50.00",
            "weight_pct": security["weight_pct"],
        }
    ]
