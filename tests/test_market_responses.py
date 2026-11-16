import pytest

from app.routers.market import _format_mover, _score_company_research


@pytest.fixture(autouse=True)
def _research_stays_offline(monkeypatch):
    """Research tests must not call Massive when a key is present in the environment."""
    monkeypatch.setattr("app.core.config.settings.massive_api_key", "")


@pytest.mark.parametrize("missing", [None, "", "None", "-", "NaN", "Infinity"])
def test_missing_mover_numbers_are_not_real_zeros(missing):
    item = _format_mover({"ticker": "MISS", "price": missing, "change_amount": missing,
                          "change_percentage": missing, "volume": missing})
    assert item == {"symbol": "MISS", "price": None, "change_amount": None, "change_percent": None, "volume": None}


def test_public_movers_keep_real_zero_and_exact_integer_volume(client, monkeypatch):
    monkeypatch.setattr("app.routers.market.get_top_gainers_losers", lambda: {"most_actively_traded": [
        {"ticker": "ZERO", "price": "10", "change_amount": "0", "change_percentage": "0%", "volume": "0"},
        {"ticker": "BIG", "price": "12", "volume": "9007199254740993"},
    ]})
    response = client.get("/market/trending")
    assert response.status_code == 200
    zero, large = response.json()["most_active"]
    assert zero == {"symbol": "ZERO", "price": 10, "change_amount": 0, "change_percent": 0, "volume": 0}
    assert large["volume"] == 9007199254740993
    assert large["change_percent"] is None


def _missing(*_args, **_kwargs):
    raise ValueError("Fixture has no data")


def test_market_cap_alone_does_not_invent_a_research_assessment(client, monkeypatch):
    monkeypatch.setattr("app.routers.market.get_company_overview", lambda _symbol: {"Name": "Fixture", "MarketCapitalization": "1000000"})
    monkeypatch.setattr("app.routers.market.get_sec_company_fundamentals", _missing)
    monkeypatch.setattr("app.routers.market.get_stock_quote", _missing)
    response = client.get("/market/research/FIXTURE")
    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "FIXTURE" and body["market_cap"] == 1000000
    assert body["research_risk_score"] is None
    assert body["research_risk_label"] is None
    assert body["errors"]


@pytest.mark.parametrize("other_margin", [None, "0.25"])
def test_zero_sec_margin_has_the_same_precedence_for_display_and_score(client, monkeypatch, other_margin):
    monkeypatch.setattr("app.routers.market.get_company_overview", lambda _symbol: {"ProfitMargin": other_margin})
    monkeypatch.setattr("app.routers.market.get_sec_company_fundamentals", lambda *_args: {"profit_margin": 0.0})
    monkeypatch.setattr("app.routers.market.get_stock_quote", lambda _symbol: {"price": 100, "change_percent": 0})
    response = client.get("/market/research/ZERO")
    assert response.status_code == 200
    body = response.json()
    assert body["profit_margin"] == 0.0
    assert body["research_risk_score"] == 50
    assert body["research_risk_label"] == "Medium"
    assert "Healthy profit margin" not in body["risk_factors"]


def test_research_keeps_the_sec_margin_period(client, monkeypatch):
    period = {"form": "10-K", "start": "2024-01-01", "end": "2024-12-31", "fp": "FY", "fy": 2024}
    monkeypatch.setattr("app.routers.market.get_company_overview", lambda _symbol: {"ProfitMargin": "0.9", "Name": "Fixture"})
    monkeypatch.setattr(
        "app.routers.market.get_sec_company_fundamentals",
        lambda *_args: {"name": "Example Corp", "profit_margin": 0.25, "profit_margin_period": period},
    )
    monkeypatch.setattr("app.routers.market.get_stock_quote", lambda _symbol: {"price": 10, "change_percent": 0})
    response = client.get("/market/research/EXMP")
    assert response.status_code == 200
    body = response.json()
    assert body["profit_margin"] == 0.25
    assert body["profit_margin_period"] == period
    assert "Healthy profit margin" in body["risk_factors"]


def test_overview_margin_does_not_inherit_an_sec_period(client, monkeypatch):
    monkeypatch.setattr("app.routers.market.get_company_overview", lambda _symbol: {"ProfitMargin": "0.2", "Name": "Fixture"})
    monkeypatch.setattr(
        "app.routers.market.get_sec_company_fundamentals",
        lambda *_args: {
            "profit_margin": None,
            "profit_margin_period": {"form": "10-K", "start": "2024-01-01", "end": "2024-12-31", "fp": "FY", "fy": 2024},
        },
    )
    monkeypatch.setattr("app.routers.market.get_stock_quote", lambda _symbol: {"price": 10, "change_percent": 0})
    response = client.get("/market/research/EXMP")
    assert response.status_code == 200
    body = response.json()
    assert body["profit_margin"] == 0.2
    assert body["profit_margin_period"] is None


def test_target_needs_a_valid_quote_before_it_can_support_a_score():
    for quote in (None, {"price": 0}, {"price": -1}, {"price": "NaN"}):
        assert _score_company_research({"AnalystTargetPrice": 200}, quote) == (None, None, [])
    assert _score_company_research({"AnalystTargetPrice": 200}, {"price": 100}) == (45, "Medium", ["Analyst target implies upside"])
