"""Company research price, market cap, and P/E. No live Massive or Alpha Vantage calls."""

from datetime import datetime, timedelta, timezone
import time

import pytest

from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_reference_cache import MarketReferenceCache
from app.models.market_symbol import MarketSymbol
from app.services.massive_client import RequestPacer
from app.services.research_valuation import (
    build_research_valuation,
    massive_shares_outstanding,
    refresh_wanted_references,
    shares_from_ticker_payload,
)


def _symbol(db, symbol="EXMP"):
    db.add(MarketSymbol(
        symbol=symbol,
        company_name="Example Corp",
        exchange="NYSE",
        sector="Technology",
        is_etf=False,
        is_test=True,
        is_active=True,
        refresh_tier="daily",
        heatmap_size="micro",
        source="test",
    ))


def _quote(db, symbol="EXMP", *, price=50, change_percent=1.25, source="massive", quote_at=None):
    _symbol(db, symbol)
    observed = datetime(2026, 11, 13) if quote_at is None else quote_at
    db.add(MarketQuoteCache(
        symbol=symbol,
        price=price,
        change_amount=1,
        change_percent=change_percent,
        volume=10,
        source=source,
        quote_at=observed,
        fetched_at=observed,
    ))
    db.commit()


def _key(monkeypatch, value="fixture-key"):
    monkeypatch.setattr("app.core.config.settings.massive_api_key", value)


def _cached_shares(db, symbol="EXMP", shares=100, source="massive_weighted", fetched_at=None):
    db.add(MarketReferenceCache(
        symbol=symbol,
        shares_outstanding=shares,
        source=source,
        fetched_at=datetime.now(timezone.utc).replace(tzinfo=None) if fetched_at is None else fetched_at,
    ))
    db.commit()


def _pacer():
    return RequestPacer(4.8, sleep=lambda _delay: (_ for _ in ()).throw(AssertionError("pacer slept")))


def _http(payload):
    calls = []

    def fetch(symbol, api_key, **_kwargs):
        calls.append((symbol, api_key))
        if isinstance(payload, Exception):
            raise payload
        return payload

    return calls, fetch


def test_weighted_shares_beat_the_share_class_count():
    assert shares_from_ticker_payload({
        "results": {"weighted_shares_outstanding": 100, "share_class_shares_outstanding": 40},
    }) == (100, "massive_weighted")
    assert shares_from_ticker_payload({
        "results": {"weighted_shares_outstanding": 0, "share_class_shares_outstanding": 40},
    }) == (40, "massive_share_class")
    assert shares_from_ticker_payload({"results": {"weighted_shares_outstanding": "nope"}}) is None


def test_fresh_share_cache_skips_the_reference_call(db_session, monkeypatch):
    _key(monkeypatch)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(MarketReferenceCache(
        symbol="EXMP", shares_outstanding=7, source="massive_weighted", fetched_at=now,
    ))
    db_session.commit()
    calls, fetch = _http(AssertionError("reference called"))

    shares, source, error = massive_shares_outstanding(db_session, "EXMP")

    assert (shares, source, error) == (7, "massive_weighted", None)
    assert calls == []
    refresh_wanted_references(db_session, http_get=fetch, pacer=_pacer())
    assert calls == []


def test_stale_share_cache_is_replaced(db_session, monkeypatch):
    _key(monkeypatch)
    stale = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=25)
    db_session.add(MarketReferenceCache(
        symbol="EXMP", shares_outstanding=1, source="massive_weighted", fetched_at=stale,
    ))
    db_session.commit()
    calls, fetch = _http({"results": {"share_class_shares_outstanding": 12}})

    shares, source, error = massive_shares_outstanding(db_session, "EXMP")

    assert calls == []
    assert (shares, source, error) == (None, None, None)
    pending = db_session.get(MarketReferenceCache, "EXMP")
    assert pending.source == "massive_pending"
    assert pending.shares_outstanding is None
    summary = refresh_wanted_references(db_session, http_get=fetch, pacer=_pacer())
    assert summary == {"requested": 1, "refreshed": 1, "errors": 0}
    assert calls == [("EXMP", "fixture-key")]
    stored = db_session.get(MarketReferenceCache, "EXMP")
    assert float(stored.shares_outstanding) == 12
    assert stored.source == "massive_share_class"
    assert massive_shares_outstanding(db_session, "EXMP") == (12, "massive_share_class", None)


def test_missing_share_count_is_remembered_for_a_day(db_session, monkeypatch):
    _key(monkeypatch)
    calls, fetch = _http({"results": {}})

    first = massive_shares_outstanding(db_session, "EXMP")
    assert first == (None, None, None)
    assert calls == []
    summary = refresh_wanted_references(db_session, http_get=fetch, pacer=_pacer())
    assert summary == {"requested": 1, "refreshed": 0, "errors": 0}
    second = massive_shares_outstanding(db_session, "EXMP")
    refresh_wanted_references(db_session, http_get=fetch, pacer=_pacer())

    assert second == (None, "massive_unavailable", None)
    assert len(calls) == 1
    stored = db_session.get(MarketReferenceCache, "EXMP")
    assert stored.shares_outstanding is None
    assert stored.source == "massive_unavailable"


def test_throttled_reference_lookup_does_not_delay_or_repeat(db_session, monkeypatch):
    _key(monkeypatch)
    http_calls = []
    retry_sleeps = []

    class Response:
        status_code = 429
        headers = {"Retry-After": "60"}

        def json(self):
            return {}

    def fake_get(url, timeout=None):
        http_calls.append("call")
        return Response()

    monkeypatch.setattr("app.services.massive_client.requests.get", fake_get)
    started = time.monotonic()
    first = massive_shares_outstanding(db_session, "EXMP")
    assert time.monotonic() - started < 1
    assert first == (None, None, None)
    assert http_calls == []
    pending = db_session.get(MarketReferenceCache, "EXMP")
    assert pending.source == "massive_pending"

    summary = refresh_wanted_references(
        db_session,
        pacer=_pacer(),
        sleeper=lambda delay: retry_sleeps.append(delay),
    )
    assert summary == {"requested": 1, "refreshed": 0, "errors": 1}
    assert http_calls == ["call"]
    assert retry_sleeps == []
    stored = db_session.get(MarketReferenceCache, "EXMP")
    assert stored.source == "massive_error"
    assert stored.shares_outstanding is None

    started = time.monotonic()
    second = massive_shares_outstanding(db_session, "EXMP")
    assert time.monotonic() - started < 1
    assert second == (None, "massive_error", None)
    assert http_calls == ["call"]
    refresh_wanted_references(db_session, pacer=_pacer(), sleeper=lambda delay: retry_sleeps.append(delay))
    assert http_calls == ["call"]
    assert retry_sleeps == []


def test_expired_reference_failure_is_queued_again(db_session, monkeypatch):
    _key(monkeypatch)
    expired = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=16)
    _cached_shares(db_session, shares=None, source="massive_error", fetched_at=expired)

    assert massive_shares_outstanding(db_session, "EXMP") == (None, None, None)
    stored = db_session.get(MarketReferenceCache, "EXMP")
    assert stored.source == "massive_pending"
    assert stored.shares_outstanding is None


def test_unset_key_does_not_call_the_reference_endpoint(db_session, monkeypatch):
    _key(monkeypatch, "")

    def boom(*_args, **_kwargs):
        raise AssertionError("reference called")

    monkeypatch.setattr("app.services.massive_client.requests.get", boom)
    assert massive_shares_outstanding(db_session, "EXMP") == (None, None, None)
    assert db_session.get(MarketReferenceCache, "EXMP") is None
    assert refresh_wanted_references(db_session) == {"requested": 0, "refreshed": 0, "errors": 0}


def test_end_of_day_close_times_massive_shares_sets_pe(db_session, monkeypatch):
    _key(monkeypatch)
    _quote(db_session)
    _cached_shares(db_session, shares=100)

    def quote_getter(_symbol):
        raise AssertionError("quote fallback called")

    valuation = build_research_valuation(
        db_session,
        "EXMP",
        {"PERatio": "10", "MarketCapitalization": "999"},
        {"ttm_diluted_eps": 2, "shares_outstanding": 8},
        quote_getter=quote_getter,
    )

    assert valuation["price"] == 50
    assert valuation["change_percent"] == pytest.approx(1.25)
    assert valuation["price_basis"] == "end_of_day_previous_close"
    assert valuation["price_as_of"] == "2026-11-13"
    assert valuation["valuation_notice"] == "End-of-day previous close as of 2026-11-13."
    assert valuation["market_cap"] == 5000
    assert valuation["market_cap_basis"] == "end_of_day_price_times_shares"
    assert valuation["shares_source"] == "massive_weighted"
    assert valuation["pe_ratio"] == 25
    assert valuation["pe_basis"] == "sec_ttm_diluted_eps"
    assert valuation["errors"] == []


def test_non_positive_trailing_eps_does_not_use_the_overview_pe(db_session, monkeypatch):
    _key(monkeypatch, "")
    _quote(db_session, price=40)

    valuation = build_research_valuation(
        db_session,
        "EXMP",
        {"PERatio": "10"},
        {"ttm_diluted_eps": -1, "shares_outstanding": 5},
        quote_getter=lambda _symbol: (_ for _ in ()).throw(AssertionError("quote fallback called")),
    )

    assert valuation["pe_ratio"] is None
    assert valuation["pe_basis"] == "sec_ttm_diluted_eps"
    assert valuation["market_cap"] == 200
    assert valuation["market_cap_basis"] == "end_of_day_price_times_shares"


def test_missing_trailing_window_uses_the_overview_pe(db_session, monkeypatch):
    _key(monkeypatch, "")
    _quote(db_session, price=40)

    valuation = build_research_valuation(
        db_session,
        "EXMP",
        {"PERatio": "10.456"},
        {"ttm_diluted_eps": None},
    )

    assert valuation["pe_ratio"] == 10.46
    assert valuation["pe_basis"] == "alpha_vantage"


def test_overview_pe_is_the_fallback_when_sec_has_no_trailing_field(db_session, monkeypatch):
    _key(monkeypatch, "")

    valuation = build_research_valuation(
        db_session,
        "EXMP",
        {"PERatio": "10", "MarketCapitalization": "1000000"},
        {},
        quote_getter=lambda _symbol: {"price": 20, "change_percent": 0},
    )

    assert valuation["price"] == 20
    assert valuation["price_basis"] == "alpha_vantage"
    assert valuation["price_as_of"] is None
    assert valuation["valuation_notice"] is None
    assert valuation["market_cap"] == 1000000
    assert valuation["market_cap_basis"] == "alpha_vantage"
    assert valuation["pe_ratio"] == 10
    assert valuation["pe_basis"] == "alpha_vantage"


def test_yahoo_cache_row_is_not_the_end_of_day_research_price(db_session, monkeypatch):
    _key(monkeypatch, "")
    _quote(db_session, source="yahoo", price=5)

    valuation = build_research_valuation(
        db_session,
        "EXMP",
        {},
        {"ttm_diluted_eps": 2, "shares_outstanding": 4},
        quote_getter=lambda _symbol: {"price": 30, "change_percent": -1},
    )

    assert valuation["price"] == 30
    assert valuation["price_basis"] == "alpha_vantage"
    assert valuation["market_cap"] == 120
    assert valuation["market_cap_basis"] == "price_times_shares"
    assert valuation["pe_ratio"] == 15


def test_pe_ratio_is_rounded_to_cents(db_session, monkeypatch):
    _key(monkeypatch, "")
    _quote(db_session, price=50)

    valuation = build_research_valuation(
        db_session,
        "EXMP",
        {},
        {"ttm_diluted_eps": 1.7, "shares_outstanding": 1},
        quote_getter=lambda _symbol: (_ for _ in ()).throw(AssertionError("quote fallback called")),
    )

    assert valuation["pe_ratio"] == 29.41
    assert valuation["pe_basis"] == "sec_ttm_diluted_eps"


def test_massive_miss_uses_sec_shares(db_session, monkeypatch):
    _key(monkeypatch)
    _quote(db_session, price=10)

    def boom(*_args, **_kwargs):
        raise AssertionError("reference called")

    monkeypatch.setattr("app.services.massive_client.requests.get", boom)
    valuation = build_research_valuation(
        db_session,
        "EXMP",
        {"MarketCapitalization": "999"},
        {"ttm_diluted_eps": 1, "shares_outstanding": 6},
    )

    assert valuation["market_cap"] == 60
    assert valuation["shares_source"] == "sec_dei"
    assert valuation["market_cap_basis"] == "end_of_day_price_times_shares"
    pending = db_session.get(MarketReferenceCache, "EXMP")
    assert pending.source == "massive_pending"


def test_research_route_labels_the_cached_close(client, db_session, monkeypatch):
    _key(monkeypatch)
    _quote(db_session, price=50, change_percent=1.25)
    _cached_shares(db_session, shares=100)
    monkeypatch.setattr(
        "app.routers.market.get_company_overview",
        lambda _symbol: {"Name": "Example Corp", "PERatio": "10", "ProfitMargin": "0.01"},
    )
    monkeypatch.setattr(
        "app.routers.market.get_sec_company_fundamentals",
        lambda *_args: {
            "name": "Example Corp",
            "profit_margin": 0.2,
            "profit_margin_period": {"form": "10-K", "start": "2024-01-01", "end": "2024-12-31", "fp": "FY", "fy": 2024},
            "ttm_diluted_eps": 2,
            "shares_outstanding": 8,
        },
    )

    def boom(_symbol):
        raise AssertionError("quote fallback called")

    monkeypatch.setattr("app.routers.market.get_stock_quote", boom)
    response = client.get("/market/research/exmp")

    assert response.status_code == 200
    body = response.json()
    assert body["price"] == 50
    assert body["price_basis"] == "end_of_day_previous_close"
    assert body["price_as_of"] == "2026-11-13"
    assert body["valuation_notice"] == "End-of-day previous close as of 2026-11-13."
    assert body["market_cap"] == 5000
    assert body["market_cap_basis"] == "end_of_day_price_times_shares"
    assert body["pe_ratio"] == 25
    assert body["pe_basis"] == "sec_ttm_diluted_eps"
    assert body["profit_margin"] == 0.2
    assert body["research_risk_score"] == 42
    assert "Moderate valuation multiple" not in body["risk_factors"]
    assert "Healthy profit margin" in body["risk_factors"]
    assert body["errors"] == []
