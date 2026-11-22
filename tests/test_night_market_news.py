from datetime import datetime, timedelta, timezone

import pytest

from app.models.market_news_cache import MarketNewsCache
from tests.night_market_fixtures import listing, market


def _row(symbol, items, fetched_at, source="yahoo"):
    return MarketNewsCache(symbol=symbol, payload=items, source=source, fetched_at=fetched_at.replace(tzinfo=None))


def test_news_canonicalizes_deduplicates_and_filters_only_explicit_tags(market):
    db, client = market
    now = datetime.now(timezone.utc)
    published = (now - timedelta(hours=1)).isoformat()
    later = (now - timedelta(minutes=30)).isoformat()
    db.add_all([listing("SPY"), listing("MSFT"), listing("AAPL"), listing("NVDA")])
    db.add_all([
        _row("SPY", [{
            "headline": "Market headline", "url": "HTTPS://Example.COM:443/story?edition=us&utm_source=yahoo#top",
            "published_at": published, "source": "Yahoo Finance RSS", "symbols": [" aapl ", "AAPL"],
            "summary": "Never returned",
        }, {
            "headline": "SPY mentioned by the title", "url": "https://reader.example/spy",
            "published_at": later, "source": "Yahoo Finance RSS",
        }], now),
        _row("MSFT", [{
            "headline": "Market headline", "url": "https://example.com/story?edition=us",
            "published_at": published, "source": "Named publisher", "related": "MSFT,AAPL,!",
        }], now, "finnhub"),
        _row("AAPL", [
            {"headline": "Script link", "url": "javascript:alert(1)", "published_at": published},
            {"headline": "Credential URL", "url": "https://user:pass@example.com/secret", "published_at": published},
            {"headline": "Invalid port", "url": "https://example.com:bad/secret", "published_at": published},
            {"headline": "Bad timestamp", "url": "https://example.com/bad-date", "published_at": "2025-04-01"},
            {"headline": "Future", "url": "https://example.com/future", "published_at": "2099-01-01T00:00:00Z"},
        ], now),
    ])
    db.commit()

    result = client.get("/night/news").json()
    assert result["coverage"] == "available" and result["as_of"].endswith("Z")
    feed_article, tagged = result["items"]
    assert (feed_article["symbols"], feed_article["publisher"]) == ([], "reader.example")
    assert tagged["url"] == "https://example.com/story?edition=us"
    assert tagged["symbols"] == ["AAPL", "MSFT"] and tagged["publisher"] == "Named publisher"
    assert set(tagged) == {"id", "title", "publisher", "url", "published_at", "symbols"}
    assert client.get("/night/news?symbol=msft").json()["items"] == [tagged]
    assert client.get("/night/news?symbol=AAPL").json()["items"] == [tagged]
    assert client.get("/night/news?limit=1").json()["items"] == [feed_article]
    for ticker in ("SPY", "NVDA"):
        response = client.get(f"/night/news?symbol={ticker}")
        assert response.status_code == 200
        assert response.json() == {"coverage": "missing", "as_of": None, "items": []}


def test_news_marks_old_cache_stale_and_ignores_future_cache_rows(market):
    db, client = market
    now = datetime.now(timezone.utc)
    backlog_time = now - timedelta(days=1)
    article = {"headline": "Headline", "url": "http://example.com:80", "published_at": backlog_time.isoformat()}
    db.add_all([
        _row("SPY", [article], backlog_time),
        _row("IWM", [article], now + timedelta(days=1)),
    ])
    db.commit()
    result = client.get("/night/news").json()
    assert result["coverage"] == "stale"
    assert len(result["items"]) == 1 and result["items"][0]["url"] == "http://example.com/"
    assert client.get("/night/news?symbol=UNKNOWN").status_code == 404


@pytest.mark.parametrize("query", ["limit=0", "limit=51", "symbol=%21", "symbol=" + "X" * 21])
def test_news_rejects_bad_filters(market, query):
    _, client = market
    response = client.get("/night/news?" + query)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_request"
