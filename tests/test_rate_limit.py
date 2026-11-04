import inspect

from fastapi.testclient import TestClient

from app.core.rate_limit import limiter
from app.routers import auth, cash, orders, trades


def test_limited_handlers_accept_the_response_slowapi_updates():
    for handler in (auth.register, auth.login, auth.complete_mfa_login, auth.setup_mfa, auth.confirm_mfa,
                    auth.enroll_mfa, auth.confirm_mfa_enrollment, auth.set_legal_name, cash.create_movement,
                    orders.create_order, orders.cancel, trades.create_trade):
        assert "response" in inspect.signature(handler).parameters


def test_register_succeeds_when_rate_limit_headers_are_enabled(client: TestClient, monkeypatch):
    monkeypatch.setattr(limiter, "enabled", True)
    response = client.post(
        "/auth/register",
        json={"email": "limited@example.com", "password": "password123"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "trader"
    assert response.headers["x-ratelimit-limit"] == "5"
