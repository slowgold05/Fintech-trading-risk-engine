import time
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.price_history_daily import PriceHistoryDaily
from app.services.eod_service import EodQuote, fetch_eod_batch
from app.services.exchange_calendar import is_nyse_trading_day
from app.services.market_providers import ProviderUnavailable, fetch_massive_grouped
from app.services.market_quality import Bar, fails_price_checks
from app.services.massive_client import http_get_massive
from app.services.price_service import AlphaVantageRateLimitError, get_stock_quote
from app.services.sector_classifier import SECTOR_ORDER, infer_sector

# Free Stocks Basic returns the completed session, not the current one.
MASSIVE_EOD_NOTICE = (
    "Massive prices are the prior session close (end of day), not real-time quotes. "
    "They are not suitable for order execution."
)
MASSIVE_FALLBACK_NOTICE = (
    "Massive end-of-day prices were unavailable, so these quotes came from Alpha Vantage. "
    "They are delayed or cached and are not suitable for order execution."
)
_PRICE_QUANTUM = Decimal("0.000001")
_PERCENT_QUANTUM = Decimal("0.0001")
_NYSE = ZoneInfo("America/New_York")


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


def latest_entitled_session(today: date | None = None) -> date:
    """Last NYSE session strictly before `today`.

    The free plan publishes a session after it is no longer the current
    session. Passing no date uses today's America/New_York calendar date.
    """
    if today is None:
        today = datetime.now(_NYSE).date()
    cursor = today - timedelta(days=1)
    for _ in range(14):
        try:
            if is_nyse_trading_day(cursor):
                return cursor
        except ValueError:
            break
        cursor -= timedelta(days=1)
    raise ProviderUnavailable("No entitled NYSE session was found before today.")


def _scrub_provider_detail(detail: str) -> str:
    text = str(detail)
    lowered = text.lower()
    if "apikey" in lowered or "api_key" in lowered or "massive_api_key" in lowered:
        return "Massive request failed."
    return text


def _named_symbol_rows(
    db: Session,
    symbols: list[str],
    limit: int,
) -> tuple[list[tuple[MarketSymbol, MarketQuoteCache | None]], list[dict]]:
    wanted: list[str] = []
    seen: set[str] = set()
    for raw in symbols:
        symbol = str(raw).strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        wanted.append(symbol)
        if len(wanted) >= limit:
            break
    if not wanted:
        return [], []
    found = (
        db.query(MarketSymbol, MarketQuoteCache)
        .outerjoin(MarketQuoteCache, MarketQuoteCache.symbol == MarketSymbol.symbol)
        .filter(
            MarketSymbol.symbol.in_(wanted),
            MarketSymbol.is_active.is_(True),
            MarketSymbol.is_test.is_(False),
        )
        .all()
    )
    by_symbol = {symbol_row.symbol: (symbol_row, cache_row) for symbol_row, cache_row in found}
    rows = [by_symbol[symbol] for symbol in wanted if symbol in by_symbol]
    errors = [
        {"symbol": symbol, "detail": "Symbol is not an active non-test symbol."}
        for symbol in wanted
        if symbol not in by_symbol
    ]
    return rows, errors


def _previous_nyse_session(day: date) -> date | None:
    cursor = day - timedelta(days=1)
    for _ in range(14):
        try:
            if is_nyse_trading_day(cursor):
                return cursor
        except ValueError:
            return None
        cursor -= timedelta(days=1)
    return None


def _prior_massive_closes(db: Session, symbols: list[str], day: date) -> dict[str, Decimal]:
    """Closes from the NYSE session immediately before `day`.

    An older stored bar is not a one-session move, so it is ignored.
    """
    previous = _previous_nyse_session(day)
    if not symbols or previous is None:
        return {}
    rows = (
        db.query(MarketBarDaily.symbol, MarketBarDaily.close)
        .filter(
            MarketBarDaily.symbol.in_(symbols),
            MarketBarDaily.session_date == previous,
            MarketBarDaily.provider == "massive",
            MarketBarDaily.adjustment_type == "raw",
            MarketBarDaily.quality_status.in_(("valid", "flagged")),
        )
        .all()
    )
    return {symbol: close for symbol, close in rows}


def _massive_quote_fields(bar: Bar, prior_close: Decimal | None) -> tuple[dict, str]:
    close = Decimal(bar.close)
    if prior_close is not None and prior_close > 0:
        base = Decimal(prior_close)
        basis = "prior_close"
    else:
        base = Decimal(bar.open)
        basis = "open_to_close"
    change = close - base
    percent = Decimal(0) if base == 0 else (change / base) * Decimal(100)
    quote = {
        "price": close.quantize(_PRICE_QUANTUM),
        "change": change.quantize(_PRICE_QUANTUM),
        "change_percent": percent.quantize(_PERCENT_QUANTUM),
        "volume": int(bar.volume),
        "quote_date": bar.day.isoformat(),
    }
    return quote, basis


def _massive_refresh_result(
    tier: str,
    *,
    requested: int,
    refreshed: int,
    errors: list[dict],
    session_day: date | None,
    refreshed_from_massive: int,
    refreshed_from_fallback: int,
    change_basis_counts: dict[str, int],
    notice: str,
) -> dict:
    return {
        "tier": tier,
        "source": "massive",
        "price_basis": "end_of_day_previous_close",
        "as_of_session": session_day.isoformat() if session_day else None,
        "notice": notice,
        "requested": requested,
        "refreshed": refreshed,
        "refreshed_from_massive": refreshed_from_massive,
        "refreshed_from_fallback": refreshed_from_fallback,
        "change_basis_counts": change_basis_counts,
        "errors": errors,
    }


def _refresh_massive_quote_cache(
    db: Session,
    rows: list[tuple[MarketSymbol, MarketQuoteCache | None]],
    tier: str,
    extra_errors: list[dict],
) -> dict:
    requested = len(rows) + len(extra_errors)
    if not rows:
        return _massive_refresh_result(
            tier,
            requested=requested,
            refreshed=0,
            errors=list(extra_errors),
            session_day=None,
            refreshed_from_massive=0,
            refreshed_from_fallback=0,
            change_basis_counts={"prior_close": 0, "open_to_close": 0},
            notice=MASSIVE_EOD_NOTICE,
        )
    try:
        session_day = latest_entitled_session()
        bars = fetch_massive_grouped(session_day, settings.massive_api_key, http_get_massive)
    except (ProviderUnavailable, ValueError, KeyError, TypeError, InvalidOperation, ArithmeticError) as exc:
        fallback = _refresh_alpha_vantage_quote_cache(db, rows, tier)
        fallback["fallback_from"] = "massive"
        fallback["notice"] = MASSIVE_FALLBACK_NOTICE
        fallback["fallback_reason"] = _scrub_provider_detail(exc)
        fallback["requested"] = requested
        fallback["errors"] = list(extra_errors) + fallback["errors"]
        return fallback

    by_symbol = {bar.symbol: bar for bar in bars}
    wanted = [symbol_row.symbol for symbol_row, _cache in rows]
    priors = _prior_massive_closes(db, wanted, session_day)
    cache_rows = {symbol_row.symbol: cache_row for symbol_row, cache_row in rows}
    errors = list(extra_errors)
    refreshed_massive = 0
    basis_counts = {"prior_close": 0, "open_to_close": 0}
    missing_rows: list[tuple[MarketSymbol, MarketQuoteCache | None]] = []

    for symbol_row, _cache in rows:
        symbol = symbol_row.symbol
        bar = by_symbol.get(symbol)
        if bar is None or fails_price_checks(bar):
            missing_rows.append((symbol_row, cache_rows[symbol]))
            continue
        quote, basis = _massive_quote_fields(bar, priors.get(symbol))
        try:
            _write_quote_cache(db, symbol, quote, "massive", cache_rows[symbol])
            db.commit()
            refreshed_massive += 1
            basis_counts[basis] += 1
        except (ValueError, OSError) as exc:
            db.rollback()
            errors.append({"symbol": symbol, "detail": _scrub_provider_detail(exc)})

    refreshed_fallback = 0
    if missing_rows:
        fallback = _refresh_alpha_vantage_quote_cache(db, missing_rows, tier)
        refreshed_fallback = fallback["refreshed"]
        errors.extend(fallback["errors"])

    return _massive_refresh_result(
        tier,
        requested=requested,
        refreshed=refreshed_massive + refreshed_fallback,
        errors=errors,
        session_day=session_day,
        refreshed_from_massive=refreshed_massive,
        refreshed_from_fallback=refreshed_fallback,
        change_basis_counts=basis_counts,
        notice=MASSIVE_EOD_NOTICE,
    )


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


def refresh_quote_cache(
    db: Session,
    tier: str,
    limit: int,
    source: str = "alpha_vantage",
    *,
    symbols: list[str] | None = None,
) -> dict:
    if source not in {"alpha_vantage", "eod", "massive"}:
        raise ValueError("Refresh source must be 'alpha_vantage', 'eod', or 'massive'.")

    extra_errors: list[dict] = []
    if symbols is not None:
        if tier not in {"hot", "daily"}:
            raise ValueError("Refresh tier must be 'hot' or 'daily'.")
        rows, extra_errors = _named_symbol_rows(db, symbols, limit)
    else:
        rows = _stale_symbol_rows(db, tier, limit)

    if source == "massive":
        return _refresh_massive_quote_cache(db, rows, tier, extra_errors)
    if source == "alpha_vantage":
        result = _refresh_alpha_vantage_quote_cache(db, rows, tier)
    else:
        result = _refresh_eod_quote_cache(db, rows, tier)

    if extra_errors:
        result = {
            **result,
            "requested": result["requested"] + len(extra_errors),
            "errors": extra_errors + result["errors"],
        }
    return result


def _as_naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _freshness(quote: MarketQuoteCache, tier: str, now: datetime | None = None) -> tuple[str, int | None]:
    if quote.quote_at is None:
        return "stale", None
    # Portfolio valuation passes one snapshot clock. Heatmap keeps the process clock.
    clock = _utcnow() if now is None else _as_naive_utc(now)
    observed = _as_naive_utc(quote.quote_at)
    age_seconds = max(0, int((clock - observed).total_seconds()))
    if quote.source in {"yahoo", "alpha_vantage", "massive"}:
        age_days = (clock.date() - observed.date()).days
        if quote.source == "massive":
            try:
                entitled = latest_entitled_session(None if now is None else clock.date())
            except (ProviderUnavailable, ValueError):
                entitled = None
            # A Friday close read on Sunday is still the latest entitled session.
            if entitled is not None and observed.date() >= entitled and age_days <= 7:
                return "delayed", age_seconds
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
    any_massive = False
    for symbol, quote in rows:
        status, age_seconds = _freshness(quote, symbol.refresh_tier)
        status_counts[status] += 1
        if quote.quote_at is not None:
            latest = max(latest, quote.quote_at) if latest else quote.quote_at
        sector = infer_sector(symbol.symbol, symbol.company_name, symbol.sector)
        if sector is None or sector == "Other":
            continue
        if quote.source == "massive":
            any_massive = True

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
            "price_basis": "end_of_day_previous_close" if quote.source == "massive" else None,
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
        "data_notice": MASSIVE_EOD_NOTICE if any_massive else "Quotes are delayed or cached and are not suitable for order execution.",
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
