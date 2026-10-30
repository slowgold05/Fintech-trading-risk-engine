from uuid import uuid4


def buy(client, headers, symbol="AAPL", quantity=1):
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


def alert_codes(client, headers):
    response = client.get("/risk/", headers=headers)
    assert response.status_code == 200
    return {
        alert["rule_code"]
        for assessment in response.json()["assessments"]
        for alert in assessment["alerts"]
    }


def test_many_trades_in_five_minutes_rule_fires(client, auth_headers):
    headers = auth_headers()

    for _ in range(6):
        assert buy(client, headers, quantity=1).status_code == 200

    assert "MANY_TRADES_5MIN" in alert_codes(client, headers)


def test_large_notional_rule_fires(client, auth_headers):
    headers = auth_headers()

    response = buy(client, headers, symbol="NVDA", quantity=40)

    assert response.status_code == 200, response.text
    assert "LARGE_TRADE" in alert_codes(client, headers)
