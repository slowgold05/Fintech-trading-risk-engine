"""GET /portfolio/risk-metrics sample volatility and maximum drawdown.

The reference digits are the contract's independently computed values
(docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md). They are not derived from
the service under test.
"""

from datetime import datetime, time
from decimal import Decimal

from app.models.user import User
from app.services.portfolio_risk import build_risk_metrics_response
from tests.test_portfolio_performance import (
    _forbid_providers,
    _pin_clock,
    _reference_sessions,
    _seed_reference,
)

_PASSTHROUGH = {
    "user": {"id": 7, "email": "risk@example.com"},
    "range": "1y",
    "requested_start": "2025-03-13",
    "requested_end": "2026-03-13",
    "read_at": "2026-03-13T18:00:00Z",
    "status": "incomplete",
}

_REFERENCE_SERIES = [
    {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000"},
    {"status": "unavailable"},
    {"status": "available", "twr_index": "1.050000", "drawdown_pct": "0.0000"},
    {"status": "available", "twr_index": "0.980000", "drawdown_pct": "6.6667"},
    {"status": "available", "twr_index": "1.030000", "drawdown_pct": "1.9048"},
    {"status": "available", "twr_index": "1.000000", "drawdown_pct": "4.7619"},
]


def _install_series(monkeypatch, series):
    payload = {**_PASSTHROUGH, "series": series}

    def fake(_db, _user_id, _email, _range_token):
        return payload

    monkeypatch.setattr("app.services.portfolio_risk.build_performance_response", fake)
    return payload


def _read():
    return build_risk_metrics_response(None, 7, "risk@example.com", "1y")


def _assert_decimal_text(value):
    assert isinstance(value, str)
    assert value != ""
    Decimal(value)


def test_reference_vector_matches_the_contract(monkeypatch):
    payload = _install_series(monkeypatch, _REFERENCE_SERIES)
    body = _read()

    assert body["observed_periods"] == 5
    assert body["return_count"] == 4
    assert body["max_drawdown_pct"] == "6.6667"
    assert body["historical_volatility_pct"] == "5.8847"
    for key in ("user", "range", "requested_start", "requested_end", "read_at", "status"):
        assert body[key] == payload[key]


def test_volatility_is_null_below_two_returns(monkeypatch):
    _install_series(monkeypatch, [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000"},
    ])
    one_day = _read()
    assert one_day["observed_periods"] == 1
    assert one_day["return_count"] == 0
    assert one_day["historical_volatility_pct"] is None
    assert one_day["max_drawdown_pct"] == "0.0000"

    _install_series(monkeypatch, [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000"},
        {"status": "unavailable"},
        {"status": "available", "twr_index": "1.050000", "drawdown_pct": "1.2500"},
    ])
    two_days = _read()
    assert two_days["observed_periods"] == 2
    assert two_days["return_count"] == 1
    assert two_days["historical_volatility_pct"] is None
    assert two_days["max_drawdown_pct"] == "1.2500"


def test_max_drawdown_is_null_with_zero_available_days(monkeypatch):
    _install_series(monkeypatch, [
        {"status": "unavailable"},
        {"status": "unavailable"},
    ])
    body = _read()
    assert body["observed_periods"] == 0
    assert body["return_count"] == 0
    assert body["max_drawdown_pct"] is None
    assert body["historical_volatility_pct"] is None


def test_route_requires_authentication_and_rejects_an_invalid_range(client, auth_headers):
    anonymous = client.get("/portfolio/risk-metrics", params={"range": "1y"})
    assert anonymous.status_code == 401

    headers = auth_headers("risk-range@example.com")
    rejected = client.get("/portfolio/risk-metrics", headers=headers, params={"range": "3y"})
    assert rejected.status_code == 422
    assert rejected.json()["detail"] == "range must be 1y or 2y."


def test_route_end_to_end_with_a_real_seeded_account(client, auth_headers, db_session, monkeypatch):
    _forbid_providers(monkeypatch)
    days = _reference_sessions()
    _pin_clock(monkeypatch, datetime.combine(days[5], time(18, 0)))
    headers = auth_headers("risk-e2e@example.com")
    user = db_session.query(User).one()
    _seed_reference(db_session, user, days, include_last_bar=True)

    response = client.get("/portfolio/risk-metrics", headers=headers, params={"range": "2y"})
    assert response.status_code == 200, response.text
    body = response.json()

    performance = client.get("/portfolio/performance", headers=headers, params={"range": "2y"})
    assert performance.status_code == 200, performance.text
    series = performance.json()["series"]
    available = sum(point["status"] == "available" for point in series)

    assert isinstance(body["observed_periods"], int)
    assert body["observed_periods"] == available
    assert body["observed_periods"] > 0
    assert body["return_count"] == max(available - 1, 0)
    for field in ("max_drawdown_pct", "historical_volatility_pct"):
        value = body[field]
        if value is None:
            continue
        _assert_decimal_text(value)
    if body["return_count"] < 2:
        assert body["historical_volatility_pct"] is None
    else:
        _assert_decimal_text(body["historical_volatility_pct"])
    _assert_decimal_text(body["max_drawdown_pct"])
