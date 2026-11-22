"""Read headline links from Yahoo Finance's per-symbol RSS feed."""

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
from xml.etree import ElementTree

import requests

from app.services.eod_service import REQUEST_HEADERS, _yahoo_symbol
from app.services.market_providers import ProviderUnavailable

_URL = "https://feeds.finance.yahoo.com/rss/2.0/headline"


def fetch_yahoo_news(symbol: str) -> list[dict]:
    try:
        response = requests.get(
            _URL,
            params={"s": _yahoo_symbol(symbol), "region": "US", "lang": "en-US"},
            headers=REQUEST_HEADERS,
            timeout=6,
        )
        response.raise_for_status()
        channel = ElementTree.fromstring(response.content).find("channel")
    except (requests.RequestException, ElementTree.ParseError):
        raise ProviderUnavailable("Yahoo Finance RSS is temporarily unavailable.") from None
    if channel is None:
        raise ProviderUnavailable("Yahoo Finance RSS returned an invalid feed.")

    now = datetime.now(timezone.utc)
    articles = {}
    for item in channel.findall("item"):
        headline = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        try:
            link = urlsplit(url)
            published = parsedate_to_datetime(item.findtext("pubDate") or "")
        except (ValueError, TypeError, OverflowError):
            continue
        if (not headline or link.scheme != "https" or not link.hostname or link.username
                or published.tzinfo is None or published > now):
            continue
        articles[url] = {
            "headline": headline,
            "summary": "",
            "source": "Yahoo Finance RSS",
            "url": url,
            "published_at": published.astimezone(timezone.utc).isoformat(),
        }
    if not articles:
        raise ProviderUnavailable("Yahoo Finance RSS returned no usable headlines.")
    return sorted(articles.values(), key=lambda article: article["published_at"], reverse=True)[:20]
