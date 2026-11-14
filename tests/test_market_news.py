"""Cached headlines for the public market indexes.

HTTP is injected through ``http_get``. Nothing here calls the live API.
"""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_news_cache import MarketNewsCache
from app.services.market_news_service import get_cached_market_news, get_market_news
from app.services.market_providers import ProviderUnavailable

_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"]
_STAMPS = {"SPY": 1_700_000_400, "QQQ": 1_700_000_300, "DIA": 1_700_000_200, "IWM": 1_700_000_100}
_PROVIDER_ERROR = "Finnhub company news request failed with status 503"


def _raw(symbol: str) -> dict:
    return {
        "headline": f"{symbol} headline",
        "summary": f"{symbol} summary",
        "source": "Reuters",
        "url": f"https://example.com/{symbol.lower()}",
        "datetime": _STAMPS[symbol],
    }


def _article(symbol: str) -> dict:
    raw = _raw(symbol)
    return {
        "headline": raw["headline"],
        "summary": raw["summary"],
        "source": raw["source"],
        "url": raw["url"],
        "published_at": datetime.fromtimestamp(raw["datetime"], timezone.utc).isoformat(),
    }


def _http_get(calls: list[str]):
    def http_get(symbol, from_date, to_date, api_key):
        assert api_key == "test-key"
        assert from_date < to_date
        calls.append(symbol)
        return [_raw(symbol)]

    return http_get


def _stale_article(symbol: str) -> dict:
    return {
        "headline": f"{symbol} stale",
        "summary": "previously cached",
        "source": "Reuters",
        "url": f"https://example.com/stale/{symbol.lower()}",
        "published_at": "2020-01-01T00:00:00+00:00",
    }


def _store_stale(db: Session, symbols: list[str]) -> datetime:
    fetched_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=3)
    for symbol in symbols:
        db.add(
            MarketNewsCache(
                symbol=symbol,
                payload=[_stale_article(symbol)],
                source="finnhub",
                fetched_at=fetched_at,
            )
        )
    db.commit()
    return fetched_at


def test_fresh_call_populates_cache_and_returns_articles(db_session: Session) -> None:
    calls: list[str] = []
    cached = get_cached_market_news(db_session, "spy", "test-key", http_get=_http_get(calls))

    assert calls == ["SPY"]
    assert cached == {"symbol": "SPY", "articles": [_article("SPY")], "error": None}
    row = db_session.get(MarketNewsCache, "SPY")
    assert row is not None
    assert row.source == "finnhub"
    assert row.payload == [_article("SPY")]
    assert row.fetched_at is not None

    merged = get_market_news(db_session, "test-key", http_get=_http_get(calls))
    assert calls == _SYMBOLS
    assert merged["articles"] == [_article(symbol) for symbol in _SYMBOLS]
    assert merged["as_of"] is not None
    for symbol in _SYMBOLS:
        stored = db_session.get(MarketNewsCache, symbol)
        assert stored is not None
        assert stored.payload == [_article(symbol)]
        assert stored.source == "finnhub"


def test_second_call_within_ttl_does_not_call_http_get(db_session: Session) -> None:
    calls: list[str] = []
    http_get = _http_get(calls)
    first = get_market_news(db_session, "test-key", http_get=http_get)
    assert calls == _SYMBOLS

    second = get_market_news(db_session, "test-key", http_get=http_get)
    assert calls == _SYMBOLS
    assert second == first

    cached = get_cached_market_news(db_session, "QQQ", "test-key", http_get=http_get)
    assert calls == _SYMBOLS
    assert cached == {"symbol": "QQQ", "articles": [_article("QQQ")], "error": None}


def test_cache_row_older_than_two_hours_triggers_a_fresh_call(db_session: Session) -> None:
    fetched_at = _store_stale(db_session, _SYMBOLS)
    calls: list[str] = []
    http_get = _http_get(calls)

    cached = get_cached_market_news(db_session, "SPY", "test-key", http_get=http_get)
    assert calls == ["SPY"]
    assert cached == {"symbol": "SPY", "articles": [_article("SPY")], "error": None}
    refreshed = db_session.get(MarketNewsCache, "SPY")
    assert refreshed is not None
    assert refreshed.payload == [_article("SPY")]
    assert refreshed.fetched_at > fetched_at

    merged = get_market_news(db_session, "test-key", http_get=http_get)
    assert calls == _SYMBOLS
    assert merged["articles"] == [_article(symbol) for symbol in _SYMBOLS]
    assert "https://example.com/stale/spy" not in [item["url"] for item in merged["articles"]]
    for symbol in _SYMBOLS:
        stored = db_session.get(MarketNewsCache, symbol)
        assert stored is not None
        assert stored.payload == [_article(symbol)]
        assert stored.fetched_at > fetched_at


def test_provider_unavailable_without_cache_returns_empty_error(db_session: Session) -> None:
    def http_get(*_args, **_kwargs):
        raise ProviderUnavailable(_PROVIDER_ERROR)

    cached = get_cached_market_news(db_session, "SPY", "test-key", http_get=http_get)
    assert cached == {"symbol": "SPY", "articles": [], "error": _PROVIDER_ERROR}
    assert db_session.get(MarketNewsCache, "SPY") is None

    merged = get_market_news(db_session, "test-key", http_get=http_get)
    assert merged == {"articles": [], "as_of": None}
    assert db_session.query(MarketNewsCache).count() == 0


def test_provider_unavailable_with_cached_row_returns_stale_payload(db_session: Session) -> None:
    fetched_at = _store_stale(db_session, ["SPY"])

    def http_get(*_args, **_kwargs):
        raise ProviderUnavailable(_PROVIDER_ERROR)

    cached = get_cached_market_news(db_session, "SPY", "test-key", http_get=http_get)
    assert cached == {"symbol": "SPY", "articles": [_stale_article("SPY")], "error": None}
    row = db_session.get(MarketNewsCache, "SPY")
    assert row is not None
    assert row.payload == [_stale_article("SPY")]
    assert row.fetched_at == fetched_at

    merged = get_market_news(db_session, "test-key", http_get=http_get)
    assert merged["articles"] == [_stale_article("SPY")]
    assert merged["as_of"] == fetched_at.replace(tzinfo=timezone.utc).isoformat()
    assert db_session.get(MarketNewsCache, "SPY").fetched_at == fetched_at
    assert db_session.query(MarketNewsCache).count() == 1


def test_empty_api_key_returns_honest_empty_without_calling_http_get(db_session: Session) -> None:
    def http_get(*_args, **_kwargs):
        raise AssertionError("http_get should not be called")

    cached = get_cached_market_news(db_session, "spy", "", http_get=http_get)
    assert cached == {"symbol": "SPY", "articles": [], "error": "FINNHUB_API_KEY is empty"}
    assert db_session.get(MarketNewsCache, "SPY") is None

    merged = get_market_news(db_session, "", http_get=http_get)
    assert merged == {"articles": [], "as_of": None}
    assert db_session.query(MarketNewsCache).count() == 0


def test_market_news_route_is_public(client: TestClient, monkeypatch) -> None:
    seen = {}

    def fake_get_market_news(db, api_key, *, http_get=None):
        seen["api_key"] = api_key
        seen["http_get"] = http_get
        return {"articles": [_article("SPY")], "as_of": "2026-11-13T00:00:00+00:00"}

    monkeypatch.setattr("app.routers.market.get_market_news", fake_get_market_news)
    monkeypatch.setattr(settings, "finnhub_api_key", "route-key")
    response = client.get("/market/news")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "articles": [_article("SPY")],
        "as_of": "2026-11-13T00:00:00+00:00",
    }
    assert seen == {"api_key": "route-key", "http_get": None}
