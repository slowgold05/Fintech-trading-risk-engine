"""HTTP client for Finnhub company news.

``http_get_finnhub_news`` performs a real GET. Callers that must not touch the
network, including this unit's tests, pass a different ``http_get``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import requests

from app.services.market_providers import ProviderUnavailable

_TIMEOUT_SECONDS = 15
_COMPANY_NEWS_URL = "https://finnhub.io/api/v1/company-news"
_ARTICLE_CAP = 20


def http_get_finnhub_news(symbol: str, from_date: str, to_date: str, api_key: str):
    """GET one company-news payload. Dates are ``YYYY-MM-DD``."""
    url = _COMPANY_NEWS_URL + "?" + urlencode(
        {"symbol": symbol, "from": from_date, "to": to_date, "token": api_key}
    )
    try:
        response = requests.get(url, timeout=_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise ProviderUnavailable(exc.__class__.__name__) from exc
    if response.status_code < 200 or response.status_code >= 300:
        raise ProviderUnavailable(
            f"Finnhub company news request failed with status {response.status_code}"
        )
    try:
        return response.json()
    except requests.RequestException as exc:
        raise ProviderUnavailable(exc.__class__.__name__) from exc
    except ValueError as exc:
        raise ProviderUnavailable(exc.__class__.__name__) from exc


def fetch_company_news(
    symbol: str,
    api_key: str,
    *,
    days_back: int = 14,
    http_get=None,
) -> list[dict]:
    if not api_key:
        raise ProviderUnavailable("FINNHUB_API_KEY is empty")
    today = datetime.now(timezone.utc).date()
    from_date = (today - timedelta(days=days_back)).isoformat()
    to_date = today.isoformat()
    getter = http_get_finnhub_news if http_get is None else http_get
    payload = getter(symbol, from_date, to_date, api_key)
    if not isinstance(payload, list):
        raise ProviderUnavailable("Finnhub company news payload is not a list")

    articles = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        headline = item.get("headline")
        url = item.get("url")
        if not headline or not url:
            continue
        try:
            published_at = datetime.fromtimestamp(item["datetime"], timezone.utc).isoformat()
        except (KeyError, TypeError, ValueError, OSError, OverflowError):
            continue
        articles.append(
            {
                "headline": headline,
                "summary": item.get("summary") or "",
                "source": item.get("source") or "",
                "url": url,
                "published_at": published_at,
            }
        )
    articles.sort(key=lambda article: article["published_at"], reverse=True)
    return articles[:_ARTICLE_CAP]
