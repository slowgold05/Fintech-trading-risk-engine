from collections import Counter
from datetime import date
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
import sys

import pytest

from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.price_history_daily import PriceHistoryDaily
from app.services.eod_service import EodDataError, EodQuote, _latest_complete_daily_bar
from app.services.market_cache_service import check_hot_quote_freshness, get_cached_heatmap, refresh_quote_cache
from app.services.price_service import AlphaVantageError, get_live_price, get_stock_quote
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


def test_eod_bar_keeps_decimal_price_and_change():
    payload = {"chart": {"result": [{"timestamp": [1793059200], "indicators": {"quote": [{
        "open": [0.1], "high": [0.3], "low": [0.1], "close": [0.3], "volume": [100],
    }]}}]}}
    quote = _latest_complete_daily_bar(payload, "PRECISION_TEST")
    assert quote.open == Decimal("0.1")
    assert quote.close == Decimal("0.3")
    assert quote.change == Decimal("0.2")
