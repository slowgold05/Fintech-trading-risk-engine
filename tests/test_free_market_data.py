from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.core.config import settings
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.services.history_series import read_analytics_closes
from app.services.yahoo_news import fetch_yahoo_news


def _symbol(db, symbol, **fields):
    db.add(MarketSymbol(symbol=symbol, company_name=symbol, sector="Technology", exchange="US", **fields))


def _bar(db, symbol, day, provider, adjustment, close, quality="valid"):
    db.add(MarketBarDaily(
        symbol=symbol, session_date=day, provider=provider, adjustment_type=adjustment,
        open=close - 1, low=close - 1, high=close, close=close, volume=100,
        fetched_at=datetime.now(timezone.utc) - timedelta(hours=1), quality_status=quality,
    ))


def test_history_indicators_and_status_use_the_same_stored_series(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "scheduled_jobs_enabled", True)
    monkeypatch.setattr(settings, "scheduled_market_daily_limit", 1)
    monkeypatch.setattr(settings, "massive_api_key", "")
    latest = datetime.now(timezone.utc).date() - timedelta(days=1)
    prior = latest - timedelta(days=1)
    _symbol(db_session, "AAPL")
    _symbol(db_session, "MSFT")
    _bar(db_session, "AAPL", prior, "yahoo", "split_adjusted", 100)
    _bar(db_session, "AAPL", latest, "yahoo", "split_adjusted", 102)
    _bar(db_session, "AAPL", latest, "massive", "split_adjusted", 50, quality="flagged")
    db_session.commit()

    params = {"interval": "1d", "range": "1m", "adjustment_type": "split_adjusted"}
    path = "/market/symbols/AAPL"
    history = client.get(f"{path}/history", params=params).json()
    assert (history["provider"], history["adjustment_type"]) == ("yahoo", "split_adjusted")
    assert len(history["bars"]) == 2
    indicators = client.get(f"{path}/indicators", params={**params, "provider": "auto", "name": "sma", "period": 2}).json()
    assert indicators["provider"] == indicators["history"]["provider"] == "yahoo"
    assert indicators["points"][-1]["value"] == "101.000000"
    empty = client.get("/market/symbols/MSFT/history", params=params).json()
    assert (empty["provider"], empty["adjustment_type"], empty["status"]) == (None, None, "unavailable")

    _bar(db_session, "AAPL", prior, "massive", "raw", 200)
    db_session.commit()
    best = client.get(f"{path}/history", params=params).json()
    assert (best["provider"], best["adjustment_type"]) == ("massive", "raw")
    assert [b["close"] for b in best["bars"]] == ["200.000000"]
    explicit = client.get(f"{path}/history", params={**params, "provider": "massive"}).json()
    assert explicit["status"] == "unavailable" and explicit["excluded_row_count"] == 1
    status = client.get("/market/data-status").json()
    assert status["scheduled_history_provider"] == "yahoo"
    assert {(s["provider"], s["adjustment_type"], s["row_count"]) for s in status["canonical_history"]["series"]} == {
        ("massive", "raw", 1), ("massive", "split_adjusted", 1), ("yahoo", "split_adjusted", 2),
    }

    selected, adjusted_sources = read_analytics_closes(db_session, ["AAPL"], prior, latest)
    assert selected == {"AAPL": [(prior, Decimal(200))]} and not adjusted_sources
    selected, adjusted_sources = read_analytics_closes(db_session, ["AAPL"], latest, latest)
    assert selected == {"AAPL": [(latest, Decimal(102))]} and adjusted_sources == {"AAPL": "yahoo"}


def test_movers_rank_only_featured_quotes_from_the_latest_session(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "alpha_vantage_api_key", "")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    session = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    for symbol, stamp, change, volume, active in [
        ("MSFT", session, -4, 250, True), ("AAPL", session, 2, 100, True),
        ("NVDA", session, 4, 120, True), ("AMZN", session, 0, 300, True),
        ("GOOG", session - timedelta(days=1), 50, 500, True),
        ("TSLA", session, 50, 900, False), ("OUTSIDE", session, 80, 1000, True),
    ]:
        _symbol(db_session, symbol, is_active=active)
        db_session.add(MarketQuoteCache(
            symbol=symbol, price=100, change_amount=change, change_percent=change,
            volume=volume, source="yahoo", quote_at=stamp, fetched_at=now,
        ))
    db_session.commit()
    result = client.get("/market/trending").json()
    assert result["source"] == "featured_universe_cached_quotes"
    assert result["session_date"] == session.date().isoformat()
    assert [item["symbol"] for item in result["top_gainers"]] == ["NVDA", "AAPL"]
    assert [item["symbol"] for item in result["top_losers"]] == ["MSFT"]
    assert [item["symbol"] for item in result["most_active"]] == ["AMZN", "MSFT", "NVDA", "AAPL"]
    assert result["errors"] == []


def test_overview_heatmap_and_research_use_labelled_history_without_quotes(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "massive_api_key", "")
    monkeypatch.setattr(settings, "alpha_vantage_api_key", "")
    monkeypatch.setattr("app.routers.market.get_sec_company_fundamentals", lambda *_: {})
    day = datetime.now(timezone.utc).date() - timedelta(days=1)
    _symbol(db_session, "SPY", is_etf=True)
    _symbol(db_session, "AAPL")
    _bar(db_session, "SPY", day, "yahoo", "split_adjusted", 225)
    _bar(db_session, "AAPL", day, "yahoo", "split_adjusted", 205)
    db_session.commit()

    trend = client.get("/market/overview").json()["trends"][0]
    heatmap = client.get("/market/heatmap").json()["items"][0]
    for item in (trend, heatmap):
        assert item["source"] == "yahoo"
        assert item["adjustment_type"] == "split_adjusted"
        assert item["price_basis"] == "end_of_day_open_to_close"
    assert heatmap["price"] == 205 and trend["value"] == 225
    research = client.get("/market/research/AAPL").json()
    assert research["price"] == 205 and research["price_as_of"] == day.isoformat()
    assert research["price_source"] == "yahoo" and research["adjustment_type"] == "split_adjusted"


def test_rss_uses_feed_headlines_links_and_publication_time(monkeypatch):
    def get(_url, *, params, **_kwargs):
        assert params["s"] == "BRK-B"

        class Response:
            content = b"""<rss><channel>
              <item><title>A &amp; B</title><link>https://finance.yahoo.com/news/a</link>
              <pubDate>Tue, 14 Nov 2023 12:00:00 GMT</pubDate></item>
              <item><title>Bad link</title><link>http://example.com/</link>
              <pubDate>Tue, 14 Nov 2023 12:00:00 GMT</pubDate></item>
            </channel></rss>"""

            def raise_for_status(self):
                pass

        return Response()

    monkeypatch.setattr("app.services.yahoo_news.requests.get", get)
    assert fetch_yahoo_news("BRK.B") == [{
        "headline": "A & B", "summary": "", "source": "Yahoo Finance RSS",
        "url": "https://finance.yahoo.com/news/a", "published_at": "2023-11-14T12:00:00+00:00",
    }]
