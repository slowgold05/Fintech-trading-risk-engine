"""Cached headlines for the four public index proxies.

Finnhub runs only when ``market_news_cache`` has no fresh row for that symbol.
A provider failure does not overwrite a row that is already stored.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.market_news_cache import MarketNewsCache
from app.services.finnhub_news import fetch_company_news
from app.services.market_providers import ProviderUnavailable

_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"]
_TTL = timedelta(hours=2)
_MERGED_CAP = 20


def _naive_utc(value: datetime | None = None) -> datetime:
    current = value if value is not None else datetime.now(timezone.utc)
    if current.tzinfo is None:
        return current
    return current.astimezone(timezone.utc).replace(tzinfo=None)


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def get_cached_market_news(db: Session, symbol: str, api_key: str, *, http_get=None) -> dict:
    symbol = symbol.upper().strip()
    cutoff = _naive_utc() - _TTL
    cached = db.get(MarketNewsCache, symbol)
    if cached is not None and _naive_utc(cached.fetched_at) >= cutoff:
        return {"symbol": symbol, "articles": list(cached.payload or []), "error": None}

    try:
        articles = fetch_company_news(symbol, api_key, http_get=http_get)
    except ProviderUnavailable as exc:
        if cached is not None:
            return {"symbol": symbol, "articles": list(cached.payload or []), "error": None}
        return {"symbol": symbol, "articles": [], "error": str(exc)}

    now = _naive_utc()
    if cached is None:
        cached = MarketNewsCache(symbol=symbol, payload=articles, source="finnhub", fetched_at=now)
        db.add(cached)
    else:
        cached.payload = articles
        cached.fetched_at = now
    db.commit()
    return {"symbol": symbol, "articles": articles, "error": None}


def get_market_news(db: Session, api_key: str, *, http_get=None) -> dict:
    collected: list[dict] = []
    fetched_at_values: list[datetime] = []
    for symbol in _SYMBOLS:
        result = get_cached_market_news(db, symbol, api_key, http_get=http_get)
        for article in result["articles"] or []:
            if isinstance(article, dict):
                collected.append(article)
        row = db.get(MarketNewsCache, symbol)
        if row is not None and row.fetched_at is not None:
            fetched_at_values.append(row.fetched_at)

    collected.sort(key=lambda article: article.get("published_at") or "", reverse=True)
    merged: list[dict] = []
    seen_urls: set[str] = set()
    for article in collected:
        url = article.get("url")
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        merged.append(article)
        if len(merged) == _MERGED_CAP:
            break

    newest = max(fetched_at_values, key=_naive_utc) if fetched_at_values else None
    return {
        "articles": merged,
        "as_of": _iso(newest) if newest is not None else None,
    }
