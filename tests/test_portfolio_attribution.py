"""GET /portfolio/attribution splits one valuation's P&L across securities and sectors."""

from decimal import Decimal

from app.models.market_symbol import MarketSymbol
from app.models.trade import Trade
from app.models.user import User
from tests.test_portfolio_valuation import _add_position, _add_quote, _add_symbol, _forbid_providers


def _seed_reference_book(db, user):
    """Same AAPL/MSFT marks the valuation reference already publishes."""
    apple = _add_position(db, user, "AAPL", "stock", Decimal("2"), Decimal("10"))
    _add_position(db, user, "MSFT", "stock", Decimal("1.5"), Decimal("40"))
    # Stored sector stays null. infer_sector returns SECTOR_BY_SYMBOL first.
    _add_symbol(db, "AAPL")
    _add_symbol(db, "MSFT")
    _add_quote(db, "AAPL", Decimal("100.25"))
    _add_quote(db, "MSFT", Decimal("10.10"))
    db.add(Trade(
        user_id=user.id,
        asset_id=apple.id,
        side="sell",
        quantity=Decimal("1"),
        price_at_execution=Decimal("12"),
        realized_pnl=Decimal("12.34"),
    ))


def test_two_technology_positions_reference_vector(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("attr@example.com")
    user = db_session.query(User).filter(User.email == "attr@example.com").one()
    user.cash_balance = Decimal("1000.00")
    _seed_reference_book(db_session, user)
    db_session.commit()

    response = client.get("/portfolio/attribution", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["read_at"].endswith("Z")
    assert body["user"]["email"] == "attr@example.com"
    assert body["total_pnl"] == "147.99"
    assert db_session.query(MarketSymbol).filter(MarketSymbol.symbol == "AAPL").one().sector is None
    assert db_session.query(MarketSymbol).filter(MarketSymbol.symbol == "MSFT").one().sector is None

    by_symbol = {item["symbol"]: item for item in body["securities"]}
    assert [item["symbol"] for item in body["securities"]] == ["AAPL", "MSFT"]
    assert by_symbol["AAPL"]["sector"] == "Technology"
    assert by_symbol["AAPL"]["realized_pnl"] == "12.34"
    assert by_symbol["AAPL"]["unrealized_pnl"] == "180.50"
    assert by_symbol["AAPL"]["total_pnl"] == "192.84"
    assert by_symbol["AAPL"]["pnl_contribution_pct"] == "130.3061"
    assert by_symbol["MSFT"]["sector"] == "Technology"
    assert by_symbol["MSFT"]["realized_pnl"] == "0.00"
    assert by_symbol["MSFT"]["unrealized_pnl"] == "-44.85"
    assert by_symbol["MSFT"]["total_pnl"] == "-44.85"
    assert by_symbol["MSFT"]["pnl_contribution_pct"] == "-30.3061"
    assert body["sectors"] == [
        {"sector": "Technology", "total_pnl": "147.99", "pnl_contribution_pct": "100.0000"},
    ]

    reported = Decimal(by_symbol["AAPL"]["pnl_contribution_pct"]) + Decimal(by_symbol["MSFT"]["pnl_contribution_pct"])
    assert reported == Decimal("100.0000")


def test_incomplete_valuation_nulls_every_contribution_percentage(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    headers = auth_headers("attr-unpriced@example.com")
    user = db_session.query(User).filter(User.email == "attr-unpriced@example.com").one()
    apple = _add_position(db_session, user, "AAPL", "stock", Decimal("2"), Decimal("10"))
    _add_symbol(db_session, "AAPL")
    db_session.add(Trade(
        user_id=user.id,
        asset_id=apple.id,
        side="sell",
        quantity=Decimal("1"),
        price_at_execution=Decimal("12"),
        realized_pnl=Decimal("12.34"),
    ))
    db_session.commit()

    response = client.get("/portfolio/attribution", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "incomplete"
    assert body["total_pnl"] is None
    assert body["sectors"] is None
    assert len(body["securities"]) == 1
    security = body["securities"][0]
    assert security["symbol"] == "AAPL"
    assert security["sector"] == "Technology"
    assert security["realized_pnl"] == "12.34"
    assert security["unrealized_pnl"] is None
    assert security["total_pnl"] is None
    assert security["pnl_contribution_pct"] is None


def test_zero_net_total_pnl_nulls_every_percentage_but_keeps_total_pnl_as_a_real_zero(
    client, auth_headers, db_session, monkeypatch
):
    _forbid_providers(monkeypatch)
    headers = auth_headers("attr-zero@example.com")
    user = db_session.query(User).filter(User.email == "attr-zero@example.com").one()
    _add_position(db_session, user, "AAPL", "stock", Decimal("1"), Decimal("100"))
    _add_position(db_session, user, "JPM", "stock", Decimal("1"), Decimal("100"))
    _add_symbol(db_session, "AAPL")
    _add_symbol(db_session, "JPM")
    _add_quote(db_session, "AAPL", Decimal("150"))
    _add_quote(db_session, "JPM", Decimal("50"))
    db_session.commit()

    response = client.get("/portfolio/attribution", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["total_pnl"] == "0.00"
    by_symbol = {item["symbol"]: item for item in body["securities"]}
    assert by_symbol["AAPL"]["total_pnl"] == "50.00"
    assert by_symbol["JPM"]["total_pnl"] == "-50.00"
    assert all(item["pnl_contribution_pct"] is None for item in body["securities"])
    assert body["sectors"] == [
        {"sector": "Technology", "total_pnl": "50.00", "pnl_contribution_pct": None},
        {"sector": "Financials", "total_pnl": "-50.00", "pnl_contribution_pct": None},
    ]
    assert all(item["pnl_contribution_pct"] is None for item in body["sectors"])


def test_a_position_contributing_more_than_the_whole_can_exceed_one_hundred_percent(
    client, auth_headers, db_session, monkeypatch
):
    _forbid_providers(monkeypatch)
    headers = auth_headers("attr-unbounded@example.com")
    user = db_session.query(User).filter(User.email == "attr-unbounded@example.com").one()
    _seed_reference_book(db_session, user)
    db_session.commit()

    response = client.get("/portfolio/attribution", headers=headers)
    assert response.status_code == 200
    body = response.json()
    reported = [Decimal(item["pnl_contribution_pct"]) for item in body["securities"]]
    reported.extend(Decimal(item["pnl_contribution_pct"]) for item in body["sectors"])
    assert any(pct > Decimal("100") or pct < Decimal("0") for pct in reported)
