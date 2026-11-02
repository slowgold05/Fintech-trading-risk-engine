from uuid import uuid4


def buy(client, headers, symbol, quantity=1):
    return client.post(
        "/trades/",
        headers={**headers, "Idempotency-Key": str(uuid4())},
        json={
            "symbol": symbol,
            "asset_type": "stock",
            "side": "buy",
            "quantity": quantity,
        },
    )


def test_users_only_see_their_own_trades_portfolio_and_risk(client, auth_headers):
    user_a = auth_headers("a@example.com")
    user_b = auth_headers("b@example.com")

    assert buy(client, user_a, "AAPL", 1).status_code == 200
    assert buy(client, user_b, "MSFT", 2).status_code == 200

    trades_a = client.get("/trades/", headers=user_a).json()["trades"]
    trades_b = client.get("/trades/", headers=user_b).json()["trades"]
    portfolio_a = client.get("/portfolio/", headers=user_a).json()["positions"]
    portfolio_b = client.get("/portfolio/", headers=user_b).json()["positions"]
    risk_a = client.get("/risk/", headers=user_a).json()["assessments"]
    risk_b = client.get("/risk/", headers=user_b).json()["assessments"]

    assert [trade["symbol"] for trade in trades_a] == ["AAPL"]
    assert [trade["symbol"] for trade in trades_b] == ["MSFT"]
    assert [position["symbol"] for position in portfolio_a] == ["AAPL"]
    assert [position["symbol"] for position in portfolio_b] == ["MSFT"]
    assert {assessment["trade"]["symbol"] for assessment in risk_a} == {"AAPL"}
    assert {assessment["trade"]["symbol"] for assessment in risk_b} == {"MSFT"}
