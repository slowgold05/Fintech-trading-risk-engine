"""GET /portfolio/risk-metrics volatility, drawdown, beta, and tail loss.

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
    {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
    {"status": "unavailable", "benchmark_index": None},
    {"status": "available", "twr_index": "1.050000", "drawdown_pct": "0.0000", "benchmark_index": "1.010000"},
    {"status": "available", "twr_index": "0.980000", "drawdown_pct": "6.6667", "benchmark_index": "1.020000"},
    {"status": "available", "twr_index": "1.030000", "drawdown_pct": "1.9048", "benchmark_index": "1.005000"},
    {"status": "available", "twr_index": "1.000000", "drawdown_pct": "4.7619", "benchmark_index": "1.015000"},
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


def _available_chain(twr_values):
    return [
        {
            "status": "available",
            "twr_index": twr,
            "drawdown_pct": "0.0000",
            "benchmark_index": None,
        }
        for twr in twr_values
    ]


_TAIL_FIELDS = (
    "historical_var_95_pct",
    "historical_var_99_pct",
    "expected_shortfall_95_pct",
    "expected_shortfall_99_pct",
)


# 121 available twr_index values. Section 3's reference is 120 returns.
_VAR_REFERENCE_TWR = (
    "1.000000,0.991192,0.973888,0.981238,0.960261,0.961984,0.955523,0.934406,0.934754,0.913138,"
    "0.910108,0.890534,0.872310,0.869018,0.883220,0.866607,0.854615,0.860061,0.879313,0.882703,"
    "0.878143,0.899054,0.878672,0.894420,0.885011,0.869269,0.852657,0.844492,0.857840,0.844145,"
    "0.847589,0.853476,0.848031,0.850055,0.831472,0.813163,0.801208,0.808435,0.805508,0.798022,"
    "0.801436,0.799560,0.791555,0.803206,0.811198,0.800819,0.803799,0.804812,0.819908,0.829314,"
    "0.820521,0.840221,0.824175,0.820801,0.831354,0.816888,0.816437,0.797626,0.804335,0.814976,"
    "0.817951,0.833307,0.825546,0.833607,0.837540,0.840886,0.839044,0.853306,0.872278,0.871148,"
    "0.878298,0.859004,0.867658,0.874040,0.895589,0.910004,0.900203,0.895063,0.902611,0.881064,"
    "0.879377,0.864781,0.848225,0.829520,0.840646,0.825066,0.814654,0.810212,0.825258,0.807952,"
    "0.805899,0.807891,0.823377,0.836521,0.851745,0.842309,0.838742,0.832820,0.848818,0.868245,"
    "0.853091,0.839280,0.828032,0.816992,0.816378,0.820016,0.810288,0.790197,0.786994,0.781849,"
    "0.784442,0.802214,0.809855,0.810483,0.815249,0.822431,0.804091,0.820154,0.831635,0.847208,"
    "0.859826"
).split(",")


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
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
    ])
    one_day = _read()
    assert one_day["observed_periods"] == 1
    assert one_day["return_count"] == 0
    assert one_day["historical_volatility_pct"] is None
    assert one_day["max_drawdown_pct"] == "0.0000"

    _install_series(monkeypatch, [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
        {"status": "unavailable", "benchmark_index": None},
        {"status": "available", "twr_index": "1.050000", "drawdown_pct": "1.2500", "benchmark_index": "1.010000"},
    ])
    two_days = _read()
    assert two_days["observed_periods"] == 2
    assert two_days["return_count"] == 1
    assert two_days["historical_volatility_pct"] is None
    assert two_days["max_drawdown_pct"] == "1.2500"


def test_max_drawdown_is_null_with_zero_available_days(monkeypatch):
    _install_series(monkeypatch, [
        {"status": "unavailable", "benchmark_index": None},
        {"status": "unavailable", "benchmark_index": "1.000000"},
    ])
    body = _read()
    assert body["observed_periods"] == 0
    assert body["return_count"] == 0
    assert body["max_drawdown_pct"] is None
    assert body["historical_volatility_pct"] is None


def test_beta_reference_vector_matches_the_contract(monkeypatch):
    # Six series days. The third is priced for the account and unpaired for SPY.
    _install_series(monkeypatch, [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
        {"status": "available", "twr_index": "1.020000", "drawdown_pct": "0.0000", "benchmark_index": "1.010000"},
        {"status": "available", "twr_index": "1.030000", "drawdown_pct": "0.0000", "benchmark_index": None},
        {"status": "available", "twr_index": "1.040000", "drawdown_pct": "0.0000", "benchmark_index": "1.020000"},
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.005000"},
        {"status": "available", "twr_index": "1.050000", "drawdown_pct": "0.0000", "benchmark_index": "1.015000"},
    ])
    body = _read()

    assert body["beta_pair_count"] == 4
    assert body["portfolio_beta"] == "2.7713"


def test_beta_is_null_below_two_pairs(monkeypatch):
    # Three priced days and no SPY index: volatility has two returns, beta has none.
    _install_series(monkeypatch, [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": None},
        {"status": "available", "twr_index": "1.050000", "drawdown_pct": "0.0000", "benchmark_index": None},
        {"status": "available", "twr_index": "0.980000", "drawdown_pct": "6.6667", "benchmark_index": None},
    ])
    none_paired = _read()
    assert none_paired["observed_periods"] == 3
    assert none_paired["return_count"] == 2
    assert none_paired["beta_pair_count"] == 0
    assert none_paired["portfolio_beta"] is None
    _assert_decimal_text(none_paired["historical_volatility_pct"])
    assert none_paired["max_drawdown_pct"] == "6.6667"

    # Same priced length, one SPY day: still zero return pairs.
    _install_series(monkeypatch, [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
        {"status": "available", "twr_index": "1.050000", "drawdown_pct": "0.0000", "benchmark_index": None},
        {"status": "available", "twr_index": "0.980000", "drawdown_pct": "6.6667", "benchmark_index": None},
    ])
    one_paired = _read()
    assert one_paired["observed_periods"] == 3
    assert one_paired["return_count"] == 2
    assert one_paired["beta_pair_count"] == 0
    assert one_paired["portfolio_beta"] is None
    _assert_decimal_text(one_paired["historical_volatility_pct"])
    assert one_paired["max_drawdown_pct"] == "6.6667"

    # Two paired days among four priced days: one beta return, three volatility
    # returns. Beta stays null on its own gate; volatility does not.
    _install_series(monkeypatch, [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
        {"status": "available", "twr_index": "1.050000", "drawdown_pct": "0.0000", "benchmark_index": None},
        {"status": "unavailable", "benchmark_index": "1.050000"},
        {"status": "available", "twr_index": "0.980000", "drawdown_pct": "6.6667", "benchmark_index": "1.010000"},
        {"status": "available", "twr_index": "1.030000", "drawdown_pct": "1.9048", "benchmark_index": None},
    ])
    two_paired = _read()
    assert two_paired["observed_periods"] == 4
    assert two_paired["return_count"] == 3
    assert two_paired["beta_pair_count"] == 1
    assert two_paired["portfolio_beta"] is None
    _assert_decimal_text(two_paired["historical_volatility_pct"])
    assert two_paired["max_drawdown_pct"] == "6.6667"


def test_beta_is_null_when_benchmark_has_no_variation(monkeypatch):
    _install_series(monkeypatch, [
        {"status": "available", "twr_index": "1.000000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
        {"status": "available", "twr_index": "1.020000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
        {"status": "unavailable", "benchmark_index": "1.000000"},
        {"status": "available", "twr_index": "1.040000", "drawdown_pct": "0.0000", "benchmark_index": "1.000000"},
        {"status": "available", "twr_index": "0.990000", "drawdown_pct": "4.8077", "benchmark_index": "1.000000"},
    ])
    body = _read()

    assert body["beta_pair_count"] == 3
    assert body["portfolio_beta"] is None
    assert body["observed_periods"] == 4
    _assert_decimal_text(body["historical_volatility_pct"])
    assert body["max_drawdown_pct"] == "4.8077"


def test_var_and_es_reference_vector_matches_the_contract(monkeypatch):
    assert len(_VAR_REFERENCE_TWR) == 121
    _install_series(monkeypatch, _available_chain(_VAR_REFERENCE_TWR))
    body = _read()

    assert body["return_count"] == 120
    assert body["historical_var_95_pct"] == "2.2300"
    assert body["historical_var_99_pct"] == "2.3872"
    assert body["expected_shortfall_95_pct"] == "2.3300"
    assert body["expected_shortfall_99_pct"] == "2.4333"
    assert Decimal(body["expected_shortfall_95_pct"]) >= Decimal(body["historical_var_95_pct"])
    assert Decimal(body["expected_shortfall_99_pct"]) >= Decimal(body["historical_var_99_pct"])


def test_var_and_es_are_null_below_twenty_returns(monkeypatch):
    # Ten available days: nine returns. Volatility's own gate is two returns.
    twr_values = [format(Decimal("1.000000") + Decimal("0.003000") * index, "f") for index in range(10)]
    _install_series(monkeypatch, _available_chain(twr_values))
    body = _read()

    assert body["observed_periods"] == 10
    assert body["return_count"] == 9
    for field in _TAIL_FIELDS:
        assert body[field] is None
    _assert_decimal_text(body["historical_volatility_pct"])
    assert body["max_drawdown_pct"] == "0.0000"


def test_var_99_is_null_below_one_hundred_returns(monkeypatch):
    # Fifty available days: 49 returns, inside [20, 99]. 95% is published; 99% is not.
    twr_values = []
    level = Decimal("1.000000")
    for index in range(50):
        twr_values.append(format(level, "f"))
        change = Decimal("-0.012000") if index % 3 == 0 else Decimal("0.004000")
        level = (level * (Decimal(1) + change)).quantize(Decimal("0.000001"))
    _install_series(monkeypatch, _available_chain(twr_values))
    body = _read()

    assert body["observed_periods"] == 50
    assert 20 <= body["return_count"] <= 99
    _assert_decimal_text(body["historical_var_95_pct"])
    _assert_decimal_text(body["expected_shortfall_95_pct"])
    assert body["historical_var_99_pct"] is None
    assert body["expected_shortfall_99_pct"] is None


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
    assert isinstance(body["beta_pair_count"], int)
    assert body["beta_pair_count"] >= 0
    if body["portfolio_beta"] is not None:
        _assert_decimal_text(body["portfolio_beta"])
    for field in _TAIL_FIELDS:
        value = body[field]
        if value is not None:
            _assert_decimal_text(value)
