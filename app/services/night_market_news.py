"""Read cached headlines with canonical links and explicit company tags."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from ipaddress import IPv6Address
import re
from urllib.parse import unquote_plus, urlsplit, urlunsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.market_news_cache import MarketNewsCache
from app.schemas.night_market import News, NewsItem
from app.services.night_market_common import normalize_symbol, parse_symbol, require_symbols, utc

_CACHE_TTL = timedelta(hours=2)
_TRACKING_KEYS = {".tsrc", "fbclid", "gclid", "mc_cid", "mc_eid"}
_HOST_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")


@dataclass(frozen=True)
class Article:
    item: NewsItem
    cached_at: datetime
    explicit_publisher: bool


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _canonical_link(value: object) -> tuple[str, str] | None:
    url = _text(value)
    if "\\" in url or any(ord(char) < 32 or char.isspace() for char in url):
        return None
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        if parsed.scheme not in {"http", "https"} or not host or parsed.username is not None:
            return None
        port = parsed.port
        if ":" in host:
            hostname = IPv6Address(host).compressed
            netloc = f"[{hostname}]"
        else:
            hostname = host.encode("idna").decode("ascii").rstrip(".").lower()
            if not all(_HOST_LABEL.fullmatch(label) for label in hostname.split(".")):
                return None
            netloc = hostname
    except (UnicodeError, ValueError):
        return None
    if port is not None and port != (443 if parsed.scheme == "https" else 80):
        netloc += f":{port}"

    query = []
    for part in parsed.query.split("&"):
        key = unquote_plus(part.partition("=")[0]).casefold()
        if part and key not in _TRACKING_KEYS and not key.startswith("utm_"):
            query.append(part)
    return urlunsplit((parsed.scheme, netloc, parsed.path or "/", "&".join(query), "")), hostname


def _article(record: dict, feed: str, cached_at: datetime, clock: datetime) -> Article | None:
    title = _text(record.get("headline")) or _text(record.get("title"))
    link = _canonical_link(record.get("canonical_url")) or _canonical_link(record.get("url"))
    if not title or link is None:
        return None
    try:
        published = datetime.fromisoformat(_text(record.get("published_at")))
        if published.tzinfo is None:
            return None
        published = utc(published)
    except (OverflowError, ValueError):
        return None
    if published > clock:
        return None

    url, hostname = link
    publisher = _text(record.get("publisher"))
    if not publisher:
        source = _text(record.get("source"))
        if source.casefold() not in {feed.casefold(), "yahoo finance rss"}:
            publisher = source

    # The cache key names the requested feed. Only article metadata can tag a company.
    tags = record.get("symbols")
    raw_tags = list(tags) if isinstance(tags, list) else []
    if feed == "finnhub" and isinstance(record.get("related"), str):
        raw_tags.extend(record["related"].split(","))
    symbols = sorted({symbol for raw in raw_tags if (symbol := parse_symbol(raw)) is not None})
    return Article(
        item=NewsItem(
            id=sha256(url.encode("utf-8")).hexdigest(), title=title, publisher=publisher or hostname,
            url=url, published_at=published, symbols=symbols,
        ),
        cached_at=cached_at,
        explicit_publisher=bool(publisher),
    )


def _rank(article: Article):
    return (article.item.published_at, article.explicit_publisher, article.cached_at, article.item.title)


def _merge(left: Article, right: Article) -> Article:
    winner = max(left, right, key=_rank)
    symbols = sorted(set(left.item.symbols).union(right.item.symbols))
    return Article(
        item=winner.item.model_copy(update={"symbols": symbols}),
        cached_at=max(left.cached_at, right.cached_at),
        explicit_publisher=winner.explicit_publisher,
    )


def read_news(db: Session, *, symbol: str, limit: int) -> News:
    ticker = normalize_symbol(symbol) if symbol else None
    with consistent_read(db):
        if ticker is not None:
            require_symbols(db, [ticker])
        clock = snapshot_clock(db)
        now = utc(clock)
        rows = db.scalars(
            select(MarketNewsCache)
            .where(MarketNewsCache.fetched_at <= clock)
            .order_by(MarketNewsCache.symbol)
        )
        articles: dict[str, Article] = {}
        for row in rows:
            if not isinstance(row.payload, list):
                continue
            cached_at = utc(row.fetched_at)
            for record in row.payload:
                if not isinstance(record, dict):
                    continue
                article = _article(record, row.source, cached_at, now)
                if article is None:
                    continue
                url = article.item.url
                articles[url] = _merge(articles[url], article) if url in articles else article

        matched = [
            article for article in articles.values() if ticker is None or ticker in article.item.symbols
        ]
        if not matched:
            return News(coverage="missing", as_of=None, items=[])

        matched.sort(key=lambda article: article.item.url)
        matched.sort(key=lambda article: article.item.published_at, reverse=True)
        as_of = max(article.cached_at for article in matched)
        coverage = "stale" if now - as_of > _CACHE_TTL else "available"
        return News(coverage=coverage, as_of=as_of, items=[article.item for article in matched[:limit]])
