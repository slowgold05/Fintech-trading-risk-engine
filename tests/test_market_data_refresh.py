from collections import Counter
from datetime import date
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
import sys

import pytest

from app.core.config import settings
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.price_history_daily import PriceHistoryDaily
from app.services.eod_service import EodDataError, EodQuote, _latest_complete_daily_bar
from app.services.market_cache_service import (
    _freshness,
    check_hot_quote_freshness,
    get_cached_heatmap,
    latest_entitled_session,
    refresh_quote_cache,
)
from app.services.market_providers import ProviderUnavailable
from app.services.price_service import AlphaVantageError, get_live_price, get_stock_quote
from app.services.scheduled_jobs import refresh_market_caches
from app.scripts import refresh_market_data


def test_eod_refresh_keeps_successful_symbols_when_one_fails(db_session, monkeypatch):
    symbols = ("AAPL", "MSFT", "NVDA")
    for symbol in symbols:
        db_session.add(
            MarketSymbol(
                symbol=symbol,
                company_name=symbol,
                exchange="NASDAQ",
                is_etf=False,
                is_test=False,
                is_active=True,
                refresh_tier="daily",
                heatmap_size="large",
                source="test",
            )
        )
    db_session.commit()

    attempts = Counter()

    def fake_quote(symbol):
        attempts[symbol] += 1
        if symbol == "MSFT":
            raise EodDataError("unavailable")
        return EodQuote(symbol, date(2026, 10, 27), 100, 101, 99, 100, 1000)

    monkeypatch.setattr("app.services.eod_service.fetch_yahoo_quote", fake_quote)
    result = refresh_quote_cache(db_session, "daily", 3, source="eod")

    assert result["refreshed"] == 2
    assert result["errors"] == [{"symbol": "MSFT", "detail": "EOD quote unavailable."}]
    assert attempts == Counter(symbols)
    assert {row.symbol for row in db_session.query(MarketQuoteCache)} == {"AAPL", "NVDA"}
    assert {row.symbol for row in db_session.query(PriceHistoryDaily)} == {"AAPL", "NVDA"}
    assert db_session.query(MarketQuoteCache).filter_by(symbol="AAPL").one().quote_at.date() == date(2026, 10, 27)


def test_old_provider_quote_is_stale_even_if_fetched_now(db_session):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(MarketSymbol(
        symbol="AAPL", company_name="Apple Inc.", exchange="NASDAQ", sector="Technology",
        is_etf=False, is_test=False, is_active=True, refresh_tier="daily",
        heatmap_size="large", source="test",
    ))
    db_session.add(MarketQuoteCache(
        symbol="AAPL", price=100, change_amount=0, change_percent=0, volume=1000,
        source="yahoo", fetched_at=now, quote_at=now - timedelta(days=10),
    ))
    db_session.commit()

    item = get_cached_heatmap(db_session)["items"][0]
    assert item["data_status"] == "stale"
    assert item["age_seconds"] >= 10 * 86400 - 1


def test_hot_quote_control_finds_missing_and_old_quotes(db_session):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for symbol in ("AAPL", "MSFT", "NVDA"):
        db_session.add(MarketSymbol(
            symbol=symbol, company_name=symbol, exchange="NASDAQ", sector="Technology",
            is_etf=False, is_test=False, is_active=True, refresh_tier="hot",
            heatmap_size="large", source="test",
        ))
    for symbol, quote_at in (("AAPL", now), ("MSFT", now - timedelta(days=10))):
        db_session.add(MarketQuoteCache(
            symbol=symbol, price=100, change_amount=0, change_percent=0, volume=1000,
            source="yahoo", fetched_at=now, quote_at=quote_at,
        ))
    db_session.commit()

    assert check_hot_quote_freshness(db_session) == {
        "checked": 3, "missing_count": 1, "stale_count": 1,
        "examples": {"missing": ["NVDA"], "stale": ["MSFT"]},
    }


def test_refresh_command_exits_nonzero_on_provider_errors(monkeypatch):
    monkeypatch.setattr(refresh_market_data, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(refresh_market_data, "refresh_quote_cache", lambda *args, **kwargs: {
        "tier": "hot", "source": "yahoo", "requested": 1, "refreshed": 0,
        "errors": [{"symbol": "AAPL", "detail": "unavailable"}],
    })
    monkeypatch.setattr(sys, "argv", ["refresh_market_data", "--limit", "1"])
    with pytest.raises(SystemExit) as exc:
        refresh_market_data.main()
    assert exc.value.code == 1


def test_provider_prices_remain_decimal_through_quote_cache(monkeypatch):
    monkeypatch.setattr("app.services.price_service.settings.alpha_vantage_api_key", "test")
    monkeypatch.setattr("app.services.price_service.requests.get", lambda *args, **kwargs: SimpleNamespace(
        json=lambda: {"Global Quote": {"05. price": "0.100001", "09. change": "0.000001"}},
    ))
    quote = get_stock_quote("PRECISION_TEST")
    assert quote["price"] == Decimal("0.100001")
    assert quote["change"] == Decimal("0.000001")
    assert get_live_price("PRECISION_TEST", "stock") == Decimal("0.100001")


def test_provider_rejects_nonfinite_price(monkeypatch):
    monkeypatch.setattr("app.services.price_service.settings.alpha_vantage_api_key", "test")
    monkeypatch.setattr("app.services.price_service.requests.get", lambda *args, **kwargs: SimpleNamespace(
        json=lambda: {"Global Quote": {"05. price": "NaN"}},
    ))
    with pytest.raises(AlphaVantageError, match="Invalid price"):
        get_stock_quote("BAD_PRICE_TEST")


def _symbol(db, symbol, tier="daily"):
    db.add(MarketSymbol(
        symbol=symbol, company_name=symbol, exchange="NASDAQ", sector="Technology",
        is_etf=False, is_test=False, is_active=True, refresh_tier=tier,
        heatmap_size="large", source="test",
    ))


def _grouped_payload():
    return {
        "status": "OK",
        "results": [
            {"T": "AAPL", "o": 100, "h": 110, "l": 90, "c": 105, "v": 1000},
            {"T": "MSFT", "o": 200, "h": 210, "l": 190, "c": 190, "v": 50},
        ],
    }


def test_eod_bar_keeps_decimal_price_and_change():
    payload = {"chart": {"result": [{"timestamp": [1793059200], "indicators": {"quote": [{
        "open": [0.1], "high": [0.3], "low": [0.1], "close": [0.3], "volume": [100],
    }]}}]}}
    quote = _latest_complete_daily_bar(payload, "PRECISION_TEST")
    assert quote.open == Decimal("0.1")
    assert quote.close == Decimal("0.3")
    assert quote.change == Decimal("0.2")


def test_quote_source_setting_defaults_to_massive():
    assert settings.market_quote_source == "massive"


def test_latest_entitled_session_is_the_previous_nyse_day():
    assert latest_entitled_session(date(2026, 11, 15)) == date(2026, 11, 13)
    assert latest_entitled_session(date(2026, 11, 16)) == date(2026, 11, 13)


def test_massive_refresh_uses_one_grouped_call_and_prior_close(db_session, monkeypatch):
    for symbol in ("AAPL", "MSFT", "GONE"):
        _symbol(db_session, symbol)
    db_session.add(MarketBarDaily(
        symbol="AAPL", session_date=date(2026, 11, 12), provider="massive",
        adjustment_type="raw", open=Decimal("100"), high=Decimal("100"),
        low=Decimal("100"), close=Decimal("100"), volume=10,
        fetched_at=datetime(2026, 11, 12, tzinfo=timezone.utc), quality_status="valid",
    ))
    db_session.commit()
    calls = []

    def fake_http(kind, day, api_key):
        calls.append((kind, day, api_key))
        return _grouped_payload()

    monkeypatch.setattr("app.services.market_cache_service.http_get_massive", fake_http)
    monkeypatch.setattr(
        "app.services.market_cache_service.latest_entitled_session",
        lambda today=None: date(2026, 11, 13),
    )
    monkeypatch.setattr(settings, "massive_api_key", "unit-key")
    monkeypatch.setattr(settings, "market_request_delay_seconds", 0)
    quotes = []

    def fake_quote(symbol):
        quotes.append(symbol)
        return {
            "price": Decimal("3"), "change": Decimal("1"), "change_percent": Decimal("50"),
            "volume": 9, "quote_date": "2026-11-13",
        }

    monkeypatch.setattr("app.services.market_cache_service.get_stock_quote", fake_quote)

    result = refresh_quote_cache(
        db_session, "daily", 10, source="massive", symbols=["AAPL", "MSFT", "GONE"],
    )

    assert calls == [("massive", date(2026, 11, 13), "unit-key")]
    assert quotes == ["GONE"]
    assert result["source"] == "massive"
    assert result["as_of_session"] == "2026-11-13"
    assert result["price_basis"] == "end_of_day_previous_close"
    assert "end of day" in result["notice"]
    assert result["refreshed_from_massive"] == 2
    assert result["refreshed_from_fallback"] == 1
    assert result["change_basis_counts"] == {"prior_close": 1, "open_to_close": 1}
    assert result["errors"] == []
    aapl = db_session.query(MarketQuoteCache).filter_by(symbol="AAPL").one()
    msft = db_session.query(MarketQuoteCache).filter_by(symbol="MSFT").one()
    gone = db_session.query(MarketQuoteCache).filter_by(symbol="GONE").one()
    assert aapl.source == "massive"
    assert aapl.price == Decimal("105.000000")
    assert aapl.change_amount == Decimal("5.000000")
    assert aapl.quote_at.date() == date(2026, 11, 13)
    assert msft.source == "massive"
    assert msft.change_amount == Decimal("-10.000000")
    assert gone.source == "alpha_vantage"


def test_massive_refresh_ignores_a_prior_close_from_an_older_session(db_session, monkeypatch):
    _symbol(db_session, "AAPL")
    db_session.add(MarketBarDaily(
        symbol="AAPL", session_date=date(2026, 11, 10), provider="massive",
        adjustment_type="raw", open=Decimal("50"), high=Decimal("50"),
        low=Decimal("50"), close=Decimal("50"), volume=10,
        fetched_at=datetime(2026, 11, 10, tzinfo=timezone.utc), quality_status="valid",
    ))
    db_session.commit()
    monkeypatch.setattr(
        "app.services.market_cache_service.http_get_massive",
        lambda kind, day, api_key: _grouped_payload(),
    )
    monkeypatch.setattr(
        "app.services.market_cache_service.latest_entitled_session",
        lambda today=None: date(2026, 11, 13),
    )
    monkeypatch.setattr(settings, "massive_api_key", "unit-key")

    result = refresh_quote_cache(db_session, "daily", 5, source="massive", symbols=["AAPL"])

    assert result["change_basis_counts"] == {"prior_close": 0, "open_to_close": 1}
    quote = db_session.query(MarketQuoteCache).one()
    assert quote.price == Decimal("105.000000")
    assert quote.change_amount == Decimal("5.000000")


def test_massive_refresh_rejects_an_inconsistent_bar_and_uses_fallback(db_session, monkeypatch):
    for symbol in ("AAPL", "MSFT"):
        _symbol(db_session, symbol)
    db_session.commit()
    monkeypatch.setattr(
        "app.services.market_cache_service.http_get_massive",
        lambda kind, day, api_key: {
            "status": "OK",
            "results": [
                {"T": "AAPL", "o": 100, "h": 110, "l": 90, "c": 105, "v": 1000},
                {"T": "MSFT", "o": 10, "h": 8, "l": 12, "c": 0, "v": 50},
            ],
        },
    )
    monkeypatch.setattr(
        "app.services.market_cache_service.latest_entitled_session",
        lambda today=None: date(2026, 11, 13),
    )
    monkeypatch.setattr(settings, "massive_api_key", "unit-key")
    monkeypatch.setattr(settings, "market_request_delay_seconds", 0)
    monkeypatch.setattr(
        "app.services.market_cache_service.get_stock_quote",
        lambda symbol: {
            "price": Decimal("4"), "change": Decimal("1"), "change_percent": Decimal("1"),
            "volume": 1, "quote_date": "2026-11-13",
        },
    )

    result = refresh_quote_cache(db_session, "daily", 5, source="massive", symbols=["AAPL", "MSFT"])

    assert result["refreshed_from_massive"] == 1
    assert result["refreshed_from_fallback"] == 1
    assert db_session.query(MarketQuoteCache).filter_by(symbol="AAPL").one().source == "massive"
    assert db_session.query(MarketQuoteCache).filter_by(symbol="MSFT").one().source == "alpha_vantage"
    assert db_session.query(MarketQuoteCache).filter_by(symbol="MSFT").one().price == Decimal("4")


def test_massive_refresh_falls_back_when_the_grouped_payload_is_malformed(db_session, monkeypatch):
    _symbol(db_session, "AAPL")
    db_session.commit()
    monkeypatch.setattr(
        "app.services.market_cache_service.http_get_massive",
        lambda kind, day, api_key: {"status": "OK", "results": [{"T": "AAPL", "o": 1, "h": 1, "l": 1, "v": 1}]},
    )
    monkeypatch.setattr(
        "app.services.market_cache_service.latest_entitled_session",
        lambda today=None: date(2026, 11, 13),
    )
    monkeypatch.setattr(settings, "massive_api_key", "unit-key")
    monkeypatch.setattr(settings, "market_request_delay_seconds", 0)
    monkeypatch.setattr(
        "app.services.market_cache_service.get_stock_quote",
        lambda symbol: {
            "price": Decimal("8"), "change": Decimal("1"), "change_percent": Decimal("1"),
            "volume": 1, "quote_date": "2026-11-13",
        },
    )

    result = refresh_quote_cache(db_session, "daily", 5, source="massive", symbols=["AAPL"])

    assert result["source"] == "alpha_vantage"
    assert result["fallback_from"] == "massive"
    assert result["refreshed"] == 1
    assert db_session.query(MarketQuoteCache).one().source == "alpha_vantage"


def test_massive_refresh_falls_back_when_the_grouped_call_fails(db_session, monkeypatch):
    _symbol(db_session, "AAPL")
    db_session.commit()

    def boom(kind, day, api_key):
        raise ProviderUnavailable("grouped daily unavailable")

    monkeypatch.setattr("app.services.market_cache_service.http_get_massive", boom)
    monkeypatch.setattr(
        "app.services.market_cache_service.latest_entitled_session",
        lambda today=None: date(2026, 11, 13),
    )
    monkeypatch.setattr(settings, "massive_api_key", "unit-key")
    monkeypatch.setattr(settings, "market_request_delay_seconds", 0)
    monkeypatch.setattr(
        "app.services.market_cache_service.get_stock_quote",
        lambda symbol: {
            "price": Decimal("4"), "change": Decimal("0"), "change_percent": Decimal("0"),
            "volume": 1, "quote_date": "2026-11-13",
        },
    )

    result = refresh_quote_cache(db_session, "daily", 5, source="massive", symbols=["AAPL"])

    assert result["source"] == "alpha_vantage"
    assert result["fallback_from"] == "massive"
    assert "Alpha Vantage" in result["notice"]
    assert result["refreshed"] == 1
    assert db_session.query(MarketQuoteCache).one().source == "alpha_vantage"


def test_massive_refresh_of_named_symbols_ignores_a_fresh_cache_row(db_session, monkeypatch):
    _symbol(db_session, "AAPL")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(MarketQuoteCache(
        symbol="AAPL", price=1, change_amount=0, change_percent=0, volume=1,
        source="yahoo", fetched_at=now, quote_at=now,
    ))
    db_session.commit()
    monkeypatch.setattr(
        "app.services.market_cache_service.http_get_massive",
        lambda kind, day, api_key: _grouped_payload(),
    )
    monkeypatch.setattr(
        "app.services.market_cache_service.latest_entitled_session",
        lambda today=None: date(2026, 11, 13),
    )
    monkeypatch.setattr(settings, "massive_api_key", "unit-key")

    skipped = refresh_quote_cache(db_session, "daily", 5, source="massive")
    forced = refresh_quote_cache(db_session, "daily", 5, source="massive", symbols=["AAPL"])

    assert skipped["requested"] == 0
    assert forced["refreshed_from_massive"] == 1
    assert db_session.query(MarketQuoteCache).one().source == "massive"


def test_massive_quote_on_the_latest_session_is_delayed_not_live(db_session):
    now = datetime(2026, 11, 15, 18, 0)
    quote = MarketQuoteCache(
        symbol="AAPL", price=1, change_amount=0, change_percent=0, volume=1,
        source="massive", fetched_at=now, quote_at=datetime(2026, 11, 13),
    )
    assert _freshness(quote, "hot", now)[0] == "delayed"
    quote.quote_at = now
    assert _freshness(quote, "hot", now)[0] == "delayed"


def test_massive_freshness_uses_the_new_york_date_after_8pm_et(db_session):
    # Tuesday 2026-11-17 21:00 EST is already Wednesday in UTC. Monday's close is still the
    # latest session the plan publishes, so it is delayed, not cached.
    now = datetime(2026, 11, 18, 2, 0)
    quote = MarketQuoteCache(
        symbol="AAPL", price=1, change_amount=0, change_percent=0, volume=1,
        source="massive", fetched_at=now, quote_at=datetime(2026, 11, 16),
    )
    assert _freshness(quote, "hot", now)[0] == "delayed"


def test_heatmap_says_end_of_day_when_a_quote_came_from_massive(db_session, monkeypatch):
    now = datetime(2026, 11, 15, 18, 0)
    monkeypatch.setattr(
        "app.services.market_cache_service._utcnow",
        lambda: now,
    )
    monkeypatch.setattr(
        "app.services.market_cache_service.latest_entitled_session",
        lambda today=None: latest_entitled_session(now.date() if today is None else today),
    )
    _symbol(db_session, "AAPL")
    db_session.add(MarketQuoteCache(
        symbol="AAPL", price=10, change_amount=1, change_percent=1, volume=100,
        source="massive", fetched_at=now,
        quote_at=datetime(2026, 11, 13),
    ))
    db_session.commit()

    heatmap = get_cached_heatmap(db_session)

    assert "end of day" in heatmap["data_notice"]
    assert heatmap["items"][0]["price_basis"] == "end_of_day_previous_close"
    assert heatmap["items"][0]["data_status"] == "delayed"


def test_unknown_refresh_source_names_massive():
    with pytest.raises(ValueError, match="massive"):
        refresh_quote_cache(None, "daily", 1, source="polygon")


def test_scheduler_uses_one_massive_batch_above_fifty(monkeypatch):
    calls = []

    def fake(db, tier, limit, source):
        calls.append((tier, limit, source))
        return {"requested": limit, "refreshed": limit, "errors": []}

    monkeypatch.setattr("app.services.scheduled_jobs.refresh_quote_cache", fake)
    monkeypatch.setattr(settings, "market_quote_source", "massive")
    monkeypatch.setattr(settings, "massive_api_key", "unit-key")
    monkeypatch.setattr(settings, "scheduled_market_hot_limit", 80)
    monkeypatch.setattr(settings, "scheduled_market_daily_limit", 0)

    summary = refresh_market_caches(object())

    assert calls == [("hot", 80, "massive")]
    assert summary["hot"]["source"] == "massive"
    assert summary["daily"] == {"requested": 0, "refreshed": 0, "error_count": 0, "source": "massive"}


def test_massive_refresh_with_an_empty_key_uses_yahoo(db_session, monkeypatch):
    monkeypatch.setattr(settings, "massive_api_key", "   ")
    db_session.add(MarketSymbol(
        symbol="AAPL", company_name="Apple Inc.", exchange="NASDAQ", sector="Technology",
        is_etf=False, is_test=False, is_active=True, refresh_tier="daily",
        heatmap_size="large", source="test",
    ))
    db_session.commit()

    def grouped(*args, **kwargs):
        raise AssertionError("grouped fetch must not run without a key")

    monkeypatch.setattr("app.services.market_cache_service.fetch_massive_grouped", grouped)
    monkeypatch.setattr(
        "app.services.eod_service.fetch_yahoo_quote",
        lambda symbol: EodQuote(symbol, date(2026, 11, 13), 10, 11, 9, 10, 100),
    )

    result = refresh_quote_cache(db_session, "daily", 5, source="massive")

    assert result["source"] == "yahoo"
    assert result["fallback_from"] == "massive"
    assert result["refreshed"] == 1
    reason = result["fallback_reason"]
    assert reason == result["notice"]
    assert "not configured" in reason.lower()
    lowered = reason.lower()
    assert "api_key" not in lowered
    assert "apikey" not in lowered
    stored = db_session.query(MarketQuoteCache).filter_by(symbol="AAPL").one()
    assert stored.source == "yahoo"
    assert stored.price == Decimal("10")


def test_scheduler_without_a_massive_key_keeps_batches_of_fifty(monkeypatch):
    calls = []

    def fake(db, tier, limit, source):
        calls.append((limit, source))
        return {
            "requested": limit,
            "refreshed": limit,
            "errors": [],
            "source": "yahoo",
            "fallback_from": "massive",
            "fallback_reason": "Massive is not configured. This refresh used Yahoo end-of-day quotes.",
        }

    monkeypatch.setattr("app.services.scheduled_jobs.refresh_quote_cache", fake)
    monkeypatch.setattr(settings, "market_quote_source", "massive")
    monkeypatch.setattr(settings, "massive_api_key", "")
    monkeypatch.setattr(settings, "scheduled_market_hot_limit", 80)
    monkeypatch.setattr(settings, "scheduled_market_daily_limit", 0)

    summary = refresh_market_caches(object())

    assert calls == [(50, "massive"), (30, "massive")]
    assert summary["hot"]["source"] == "yahoo"
    assert "not configured" in summary["hot"]["fallback_reason"].lower()
    assert "api_key" not in summary["hot"]["fallback_reason"].lower()


def test_scheduler_keeps_batches_of_fifty_for_eod(monkeypatch):
    calls = []

    def fake(db, tier, limit, source):
        calls.append(limit)
        return {"requested": limit, "refreshed": limit, "errors": []}

    monkeypatch.setattr("app.services.scheduled_jobs.refresh_quote_cache", fake)
    monkeypatch.setattr(settings, "market_quote_source", "eod")
    monkeypatch.setattr(settings, "scheduled_market_hot_limit", 120)
    monkeypatch.setattr(settings, "scheduled_market_daily_limit", 0)

    refresh_market_caches(object())

    assert calls == [50, 50, 20]


def test_overview_marks_a_massive_index_quote(client, db_session):
    db_session.add(MarketSymbol(
        symbol="SPY", company_name="SPDR S&P 500", exchange="NYSE", sector="Financials",
        is_etf=True, is_test=False, is_active=True, refresh_tier="daily",
        heatmap_size="mega", source="test",
    ))
    db_session.add(MarketQuoteCache(
        symbol="SPY", price=Decimal("754.37"), change_amount=Decimal("1.2"),
        change_percent=Decimal("0.16"), volume=1000, source="massive",
        fetched_at=datetime(2026, 11, 15, 18, 0), quote_at=datetime(2026, 11, 13),
    ))
    db_session.commit()

    body = client.get("/market/overview").json()

    assert "end of day" in body["data_notice"]
    assert body["trends"][0]["source_symbol"] == "SPY"
    assert body["trends"][0]["price_basis"] == "end_of_day_previous_close"


def test_overview_marks_a_massive_sector_quote(client, db_session):
    db_session.add(MarketQuoteCache(
        symbol="XLK", price=Decimal("220"), change_amount=Decimal("2"),
        change_percent=Decimal("0.90"), volume=1000, source="massive",
        fetched_at=datetime(2026, 11, 15, 18, 0), quote_at=datetime(2026, 11, 13),
    ))
    db_session.commit()

    body = client.get("/market/overview").json()
    sector = next(item for item in body["sectors"] if item["symbol"] == "XLK")

    assert "end of day" in body["data_notice"]
    assert sector["price_basis"] == "end_of_day_previous_close"
