"""Rule eligibility and lossless mapping of displayed text to evidence."""

from datetime import date, datetime
from decimal import Decimal
import re

import pytest

from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.routers.night_portfolio_review import insights_router, review_router
from tests.test_night_portfolio_review import (
    CLOCK, END, REVIEW, _close, _flow_book, _headers, _new_book, _post_on, _stock, mount_night_api,
)
from tests.test_portfolio_performance import _add_quote, _add_symbol
from app.services.trade_execution import execute_fill

INSIGHTS = "/night/portfolio/insights"


@pytest.fixture
def insight_client(db_session, monkeypatch):
    monkeypatch.setattr("app.core.read_snapshot._python_utc_now", lambda: CLOCK)
    return mount_night_api(db_session, insights_router)


def _insights(client, owner, surface):
    response = client.get(INSIGHTS, params={"surface": surface}, headers=_headers(owner))
    assert response.status_code == 200, response.text
    assert response.headers["X-Night-Insight-Rules"] == "v1"
    result = response.json()
    assert result["surface"] == surface
    for item in result["items"]:
        _verify_evidence(item)
    return result


def _verify_evidence(item):
    sentence = item["text"]
    dates = set(re.findall(r"\d{4}-\d{2}-\d{2}", sentence))
    assert dates == {entry[field] for entry in item["evidence"] for field in ("from_date", "to_date")}
    text = re.sub(r"\d{4}-\d{2}-\d{2}", "", sentence)
    amounts = re.findall(r"(?<![\w.])-?\d+(?:\.\d+)?%?(?![\w.])", text.rstrip("."))
    expected = []
    for entry in item["evidence"]:
        if entry["unit"] == "ratio":
            expected.append(f"{Decimal(entry['value']) * 100:.2f}%")
        elif entry["unit"] == "usd":
            expected.append(entry["value"])
            assert f"{entry['value']} USD" in text
        else:
            assert isinstance(entry["value"], int) and "session" in text
            expected.append(str(entry["value"]))
    assert amounts == expected


def test_today_nets_flow_across_a_named_gap(insight_client, db_session, monkeypatch):
    owner, (_, prior, _, _, end) = _flow_book(db_session, monkeypatch)
    today = _insights(insight_client, owner, "today")
    assert [item["rule"] for item in today["items"]] == ["close_change", "coverage_gap"]
    change = today["items"][0]
    assert change["text"] == (
        "Net of external flows, the account value changed by -50.00 USD from 2026-03-10 to 2026-03-13, "
        "with 2 unvalued sessions in between."
    )
    assert change["evidence"] == [
        {"label": "net_account_change", "value": "-50.00", "unit": "usd",
         "from_date": prior.isoformat(), "to_date": end.isoformat(), "source": None},
        {"label": "intervening_missing_sessions", "value": 2, "unit": "count",
         "from_date": prior.isoformat(), "to_date": end.isoformat(), "source": None},
    ]
    assert today["omitted"] == []

    portfolio = _insights(insight_client, owner, "portfolio")
    assert [item["rule"] for item in portfolio["items"]] == ["coverage_gap"]
    assert portfolio["omitted"] == [
        {"rule": "spy_comparison", "reason": "A portfolio or SPY session is missing inside the comparison."},
        {"rule": "largest_holding", "reason": "The account has no holdings."},
    ]


def _concentrated_book(db, monkeypatch):
    days = (date(2026, 3, 11), date(2026, 3, 12), END)
    owner = _new_book(db, days[0], "1000")
    for symbol in ("ZZZ", "AAA2"):
        asset = _stock(db, symbol)
        _post_on(monkeypatch, days[0], execute_fill, db, owner, asset, "buy", Decimal(1), Decimal(250))
        for day in days:
            _close(db, symbol, day, 250)
        _add_quote(db, symbol, Decimal(250), quote_at=datetime(2026, 3, 13, 21))
    _add_symbol(db, "SPY")
    for day, amount in zip(days, (100, 101, 102), strict=True):
        _close(db, "SPY", day, amount)
    db.commit()
    return owner, days


def test_portfolio_compares_matching_dates_and_breaks_weight_ties_by_symbol(insight_client, db_session, monkeypatch):
    owner, (start, _, end) = _concentrated_book(db_session, monkeypatch)
    result = _insights(insight_client, owner, "portfolio")
    comparison, largest, gap = result["items"]
    assert [entry["rule"] for entry in (comparison, largest, gap)] == [
        "spy_comparison", "largest_holding", "coverage_gap",
    ]
    assert comparison["text"] == (
        "From 2026-03-11 to 2026-03-13, the portfolio returned 0.00% and SPY returned 2.00% using fixture raw closes."
    )
    assert comparison["evidence"] == [
        {"label": "portfolio_return", "value": "0.0000", "unit": "ratio",
         "from_date": start.isoformat(), "to_date": end.isoformat(), "source": None},
        {"label": "spy_price_return", "value": "0.0200", "unit": "ratio",
         "from_date": start.isoformat(), "to_date": end.isoformat(),
         "source": {"provider": "fixture", "basis": "raw", "session_date": end.isoformat(),
                    "observed_at": None, "coverage": "available"}},
    ]
    assert largest["text"] == "On 2026-03-15, AAA2 was the largest holding at 25.00% of priced assets and cash."
    assert largest["evidence"] == [
        {"label": "largest_holding_weight", "value": "0.2500", "unit": "ratio",
         "from_date": "2026-03-15", "to_date": "2026-03-15", "source": None},
    ]

    cash_only = _new_book(db_session, start, "600", email="second-fixture@example.com")
    other = _insights(insight_client, cash_only, "portfolio")
    assert [entry["rule"] for entry in other["items"]] == ["spy_comparison", "coverage_gap"]
    assert "AAA" not in str(other)
    assert {"rule": "largest_holding", "reason": "The account has no holdings."} in other["omitted"]


def test_stale_close_missing_quote_and_spy_gap_suppress_only_affected_rules(insight_client, db_session, monkeypatch):
    owner, (_, middle, end) = _concentrated_book(db_session, monkeypatch)
    db_session.get(MarketQuoteCache, "AAA2").quote_at = datetime(2026, 3, 12, 21)
    db_session.commit()
    stale_quote = _insights(insight_client, owner, "portfolio")
    assert {item["rule"] for item in stale_quote["items"]} == {"spy_comparison", "coverage_gap"}
    assert "older than" in stale_quote["omitted"][0]["reason"]

    db_session.delete(db_session.get(MarketQuoteCache, "AAA2"))
    db_session.commit()
    missing_quote = _insights(insight_client, owner, "portfolio")
    assert {item["rule"] for item in missing_quote["items"]} == {"spy_comparison", "coverage_gap"}
    assert "fully priced" in missing_quote["omitted"][0]["reason"]

    _add_quote(db_session, "AAA2", Decimal(250), quote_at=datetime(2026, 3, 13, 21))
    db_session.delete(db_session.get(MarketBarDaily, ("SPY", middle, "fixture", "raw")))
    db_session.commit()
    gapped = _insights(insight_client, owner, "portfolio")
    assert {item["rule"] for item in gapped["items"]} == {"largest_holding", "coverage_gap"}
    assert "missing inside" in gapped["omitted"][0]["reason"]
    assert _insights(insight_client, owner, "today")["items"][0]["rule"] == "close_change"

    db_session.delete(db_session.get(MarketBarDaily, ("AAA2", end, "fixture", "raw")))
    db_session.commit()
    today = _insights(insight_client, owner, "today")
    assert today["coverage"] == "stale"
    assert [item["rule"] for item in today["items"]] == ["coverage_gap"]
    assert "latest entitled session" in today["omitted"][0]["reason"]


def test_incompatible_units_omit_pnl_and_comparison(insight_client, db_session, monkeypatch):
    owner, (start, middle, end) = _concentrated_book(db_session, monkeypatch)
    for day in (start, middle, end):
        db_session.delete(db_session.get(MarketBarDaily, ("AAA2", day, "fixture", "raw")))
        _close(db_session, "AAA2", day, 250, adjustment="split_adjusted")
    db_session.commit()
    today = _insights(insight_client, owner, "today")
    assert today["omitted"] == [
        {"rule": "close_change", "reason": "Marks and posted share units could not be reconciled."},
    ]
    portfolio = _insights(insight_client, owner, "portfolio")
    assert portfolio["omitted"] == [
        {"rule": "spy_comparison", "reason": "Marks and posted share units could not be reconciled."},
    ]
    assert {item["rule"] for item in portfolio["items"]} == {"largest_holding", "coverage_gap"}


def test_insight_validation_and_separate_registration(insight_client, db_session):
    owner = _new_book(db_session, date(2026, 3, 12), "100")
    headers = _headers(owner)
    assert insight_client.get(INSIGHTS, params={"surface": "today"}).status_code == 401
    assert insight_client.get(REVIEW, headers=headers).status_code == 404
    assert mount_night_api(db_session, review_router).get(INSIGHTS, headers=headers).status_code == 404
    for params, field in [
        ({}, "surface"), ({"surface": "account"}, "surface"),
        ({"surface": "today", "window": "1m"}, "window"),
        ({"surface": "portfolio", "window": "6m"}, "window"),
    ]:
        response = insight_client.get(INSIGHTS, params=params, headers=headers)
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "invalid_request"
        assert list(detail["fields"]) == [field]
    assert _insights(insight_client, owner, "today")["items"][0]["evidence"][0]["value"] == "0.00"
