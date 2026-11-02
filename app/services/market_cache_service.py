import time
from datetime import date, datetime, time as datetime_time, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.price_history_daily import PriceHistoryDaily
from app.services.eod_service import EodQuote, fetch_eod_batch
from app.services.price_service import AlphaVantageRateLimitError, get_stock_quote
from app.services.sector_classifier import SECTOR_ORDER, infer_sector


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _stale_symbol_rows(db: Session, tier: str, limit: int) -> list[tuple[MarketSymbol, MarketQuoteCache | None]]:
    if tier not in {"hot", "daily"}:
        raise ValueError("Refresh tier must be 'hot' or 'daily'.")

    refresh_age = (
        timedelta(minutes=settings.market_hot_refresh_minutes)
        if tier == "hot"
        else timedelta(hours=settings.market_daily_refresh_hours)
    )
    cutoff = _utcnow() - refresh_age
    rows = (
        db.query(MarketSymbol, MarketQuoteCache)
        .outerjoin(MarketQuoteCache, MarketQuoteCache.symbol == MarketSymbol.symbol)
        .filter(
            MarketSymbol.is_active.is_(True),
            MarketSymbol.is_test.is_(False),
            MarketSymbol.refresh_tier == tier,
            or_(MarketQuoteCache.symbol.is_(None), MarketQuoteCache.quote_at.is_(None), MarketQuoteCache.fetched_at < cutoff),
        )
        .order_by(MarketQuoteCache.fetched_at.asc())
        .limit(limit)
        .all()
    )
    return rows


def _write_quote_cache(
    db: Session,
    symbol: str,
    quote: dict,
    source: str,
    cache_row: MarketQuoteCache | None,
) -> MarketQuoteCache:
    if cache_row is None:
        cache_row = MarketQuoteCache(symbol=symbol)
        db.add(cache_row)
    cache_row.price = quote["price"]
    cache_row.change_amount = quote.get("change", 0)
    cache_row.change_percent = quote.get("change_percent", 0)
    cache_row.volume = quote.get("volume", 0)
    cache_row.source = source
    quote_date = quote.get("quote_date")
    cache_row.quote_at = datetime.combine(date.fromisoformat(quote_date), datetime_time.min) if quote_date else None
    cache_row.fetched_at = _utcnow()
    return cache_row


def _write_price_history_daily(db: Session, quote: EodQuote, source: str) -> None:
    row = (
        db.query(PriceHistoryDaily)
        .filter(
            PriceHistoryDaily.symbol == quote.symbol,
            PriceHistoryDaily.date == quote.date,
        )
        .first()
    )
    if row is None:
        row = PriceHistoryDaily(symbol=quote.symbol, date=quote.date)
        db.add(row)

    row.open = quote.open
    row.high = quote.high
    row.low = quote.low
    row.close = quote.close
    row.volume = quote.volume
    row.source = source


def _refresh_alpha_vantage_quote_cache(db: Session, rows: list[tuple[MarketSymbol, MarketQuoteCache | None]], tier: str) -> dict:
    refreshed = 0
    errors = []
    for index, (symbol_row, cache_row) in enumerate(rows):
        try:
            quote = get_stock_quote(symbol_row.symbol)
            _write_quote_cache(db, symbol_row.symbol, quote, "alpha_vantage", cache_row)
            db.commit()
            refreshed += 1
        except AlphaVantageRateLimitError as exc:
            db.rollback()
            errors.append({"symbol": symbol_row.symbol, "detail": str(exc)})
            break
        except (ValueError, OSError) as exc:
            db.rollback()
            errors.append({"symbol": symbol_row.symbol, "detail": str(exc)})

        if index < len(rows) - 1 and settings.market_request_delay_seconds > 0:
            time.sleep(settings.market_request_delay_seconds)

    return {
        "tier": tier,
        "source": "alpha_vantage",
        "requested": len(rows),
        "refreshed": refreshed,
        "errors": errors,
    }


def _refresh_eod_quote_cache(db: Session, rows: list[tuple[MarketSymbol, MarketQuoteCache | None]], tier: str) -> dict:
    refreshed = 0
    errors = []
    cache_rows = {symbol_row.symbol: cache_row for symbol_row, cache_row in rows}
    symbols = list(cache_rows.keys())

    quotes = fetch_eod_batch(symbols)

    for symbol in symbols:
        quote = quotes.get(symbol)
        if quote is None:
            errors.append({"symbol": symbol, "detail": "EOD quote unavailable."})
            continue

        try:
            _write_quote_cache(db, symbol, quote.as_quote(), "yahoo", cache_rows[symbol])
            _write_price_history_daily(db, quote, "yahoo")
            db.commit()
            refreshed += 1
        except (ValueError, OSError) as exc:
            db.rollback()
            errors.append({"symbol": symbol, "detail": str(exc)})

    return {
        "tier": tier,
        "source": "yahoo",
        "requested": len(rows),
        "refreshed": refreshed,
        "errors": errors,
    }


def refresh_quote_cache(db: Session, tier: str, limit: int, source: str = "alpha_vantage") -> dict:
    rows = _stale_symbol_rows(db, tier, limit)

    if source == "alpha_vantage":
        return _refresh_alpha_vantage_quote_cache(db, rows, tier)
    if source == "eod":
        return _refresh_eod_quote_cache(db, rows, tier)

    raise ValueError("Refresh source must be 'alpha_vantage' or 'eod'.")


def _freshness(quote: MarketQuoteCache, tier: str) -> tuple[str, int | None]:
    if quote.quote_at is None:
        return "stale", None
    age_seconds = max(0, int((_utcnow() - quote.quote_at).total_seconds()))
    if quote.source in {"yahoo", "alpha_vantage"}:
        age_days = (_utcnow().date() - quote.quote_at.date()).days
        if age_days <= 1:
            return "delayed", age_seconds
        # shortcut: seven days covers market closures; use an exchange calendar for tighter limits.
        if age_days <= 7:
            return "cached", age_seconds
        return "stale", age_seconds
    if tier == "hot" and age_seconds <= settings.market_hot_refresh_minutes * 60:
        return "live-ish", age_seconds
    if age_seconds <= settings.market_daily_refresh_hours * 3600:
        return "delayed", age_seconds
    if age_seconds <= 7 * 86400:
        return "cached", age_seconds
    return "stale", age_seconds


def get_cached_heatmap(db: Session, limit: int = 1000) -> dict:
    rows = (
        db.query(MarketSymbol, MarketQuoteCache)
        .join(MarketQuoteCache, MarketQuoteCache.symbol == MarketSymbol.symbol)
        .filter(
            MarketSymbol.is_active.is_(True),
            MarketSymbol.is_test.is_(False),
            MarketSymbol.is_etf.is_(False),
        )
        .order_by(MarketSymbol.refresh_tier.asc(), MarketQuoteCache.volume.desc())
        .limit(limit)
        .all()
    )

    items = []
    status_counts = {"live-ish": 0, "delayed": 0, "cached": 0, "stale": 0}
    latest = None
    for symbol, quote in rows:
        status, age_seconds = _freshness(quote, symbol.refresh_tier)
        status_counts[status] += 1
        if quote.quote_at is not None:
            latest = max(latest, quote.quote_at) if latest else quote.quote_at
        sector = infer_sector(symbol.symbol, symbol.company_name, symbol.sector)
        if sector is None or sector == "Other":
            continue

        items.append({
            "symbol": symbol.symbol,
            "company": symbol.company_name,
            "exchange": symbol.exchange,
            "sector": sector,
            "price": float(quote.price),
            "change_percent": float(quote.change_percent),
            "volume": quote.volume,
            "size": symbol.heatmap_size,
            "refresh_tier": symbol.refresh_tier,
            "data_status": status,
            "age_seconds": age_seconds,
            "source": quote.source,
            "as_of": quote.quote_at.replace(tzinfo=timezone.utc).isoformat() if quote.quote_at else None,
        })

    sector_rank = {sector: index for index, sector in enumerate(SECTOR_ORDER)}
    size_rank = {"mega": 0, "large": 1, "medium": 2, "small": 3, "micro": 4}
    items.sort(
        key=lambda item: (
            sector_rank.get(item["sector"], sector_rank["Other"]),
            size_rank.get(item["size"], 5),
            -item["volume"],
            item["symbol"],
        )
    )

    return {
        "as_of": latest.replace(tzinfo=timezone.utc).isoformat() if latest else None,
        "data_notice": "Quotes are delayed or cached and are not suitable for order execution.",
        "status_counts": status_counts,
        "items": items,
    }


def check_hot_quote_freshness(db: Session) -> dict:
    rows = (
        db.query(MarketSymbol, MarketQuoteCache)
        .outerjoin(MarketQuoteCache, MarketQuoteCache.symbol == MarketSymbol.symbol)
        .filter(
            MarketSymbol.is_active.is_(True),
            MarketSymbol.is_test.is_(False),
            MarketSymbol.refresh_tier == "hot",
        )
        .all()
    )
    missing = []
    stale = []
    for symbol, quote in rows:
        if quote is None:
            missing.append(symbol.symbol)
        elif _freshness(quote, "hot")[0] == "stale":
            stale.append(symbol.symbol)
    return {
        "checked": len(rows),
        "missing_count": len(missing),
        "stale_count": len(stale),
        "examples": {"missing": missing[:20], "stale": stale[:20]},
    }
