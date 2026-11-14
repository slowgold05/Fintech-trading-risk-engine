"""Company news on the research desk. Finnhub is mocked; nothing here calls the live API."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_symbol import MarketSymbol

_UNKNOWN_SYMBOL = "Unknown or inactive stock symbol"


def _seed(db: Session, symbol: str, *, active: bool = True) -> None:
    db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=active))
    db.commit()


def test_research_news_returns_normalized_articles(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("news-ok@example.com")
    articles = [
        {
            "headline": "Apple rises",
            "summary": "Shares climbed.",
            "source": "Reuters",
            "url": "https://example.com/a",
            "published_at": "2026-11-10T15:00:00+00:00",
        }
    ]
    seen = {}

    def fake_fetch(symbol, api_key, *, days_back=14, http_get=None):
        seen["symbol"] = symbol
        seen["api_key"] = api_key
        seen["days_back"] = days_back
        seen["http_get"] = http_get
        return articles

    monkeypatch.setattr("app.routers.research.fetch_company_news", fake_fetch)
    response = client.get("/research/news/aapl", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json() == {"symbol": "AAPL", "articles": articles, "error": None}
    assert seen == {
        "symbol": "AAPL",
        "api_key": settings.finnhub_api_key,
        "days_back": 14,
        "http_get": None,
    }


def test_empty_finnhub_key_returns_no_articles(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    _seed(db_session, "AAPL")
    monkeypatch.setattr(settings, "finnhub_api_key", "")
    headers = auth_headers("news-empty@example.com")
    response = client.get("/research/news/AAPL", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "symbol": "AAPL",
        "articles": [],
        "error": "FINNHUB_API_KEY is empty",
    }


def test_research_news_rejects_unknown_or_inactive_symbol(
    client: TestClient, auth_headers, db_session: Session
) -> None:
    _seed(db_session, "DEAD", active=False)
    headers = auth_headers("news-unknown@example.com")
    unknown = client.get("/research/news/NOPE", headers=headers)
    inactive = client.get("/research/news/DEAD", headers=headers)
    assert unknown.status_code == 400, unknown.text
    assert inactive.status_code == 400, inactive.text
    assert unknown.json()["detail"] == _UNKNOWN_SYMBOL
    assert inactive.json()["detail"] == _UNKNOWN_SYMBOL
