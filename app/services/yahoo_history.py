"""Keyless Yahoo split-adjusted daily history and associated EOD quotes."""

import json
import re
import time
from datetime import date, datetime, time as midnight, timedelta, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from sqlalchemy import func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.watchlist import WatchlistItem
from app.services.eod_service import EodQuote, REQUEST_HEADERS, _yahoo_symbol
from app.services.exchange_calendar import is_nyse_trading_day
from app.services.featured_market import INDEX_SYMBOLS, SECTOR_SYMBOLS
from app.services.history_series import YAHOO_SERIES
from app.services.market_cache_service import _write_quote_cache
from app.services.market_history import PRICE_QUANTUM, two_calendar_years_before
from app.services.market_quality import Bar, check_bars, fails_price_checks
from app.services.massive_ingestion import latest_finished_nyse_session, nyse_calendar_today
from app.services.nasdaq_universe_service import FEATURED_METADATA, HOT_SYMBOLS
from app.services.sp500_constituents import load_sp500_constituents

_PROVIDER, _ADJUSTMENT = YAHOO_SERIES
_NY = ZoneInfo("America/New_York")
_SYMBOL = re.compile(r"[A-Z0-9][A-Z0-9.-]{0,19}")
_FIELDS = ("open", "high", "low", "close", "volume")
_REQUEST_PAUSE = 1.0
_ATTEMPTS = 3
_MAX_RETRY_WAIT = 30


class YahooRateLimited(ValueError):
    """Yahoo requested a pause beyond this run's retry budget."""


def _retry_wait(response, attempt):
    value = response.headers.get("Retry-After") if response is not None else None
    if value:
        try:
            return max(1, int(value))
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(value)
                return max(1, (retry_at - datetime.now(timezone.utc)).total_seconds())
            except (TypeError, ValueError, OverflowError):
                pass
    return 2 ** (attempt + 1)


def _chart(http, symbol, start, end):
    yahoo_symbol = _yahoo_symbol(symbol)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(yahoo_symbol, safe='')}"
    params = {
        "period1": int(datetime.combine(start, midnight(), _NY).timestamp()),
        "period2": int(datetime.combine(end + timedelta(days=1), midnight(), _NY).timestamp()),
        "interval": "1d",
        "includeAdjustedClose": "false",
    }
    time.sleep(_REQUEST_PAUSE)
    for attempt in range(_ATTEMPTS):
        response = None
        rate_limited = False
        try:
            response = http.get(url, params=params, timeout=20)
            response.raise_for_status()
        except requests.HTTPError:
            status = response.status_code
            rate_limited = status == 429
            if not rate_limited and status not in (500, 502, 503, 504):
                raise
        except (requests.ConnectionError, requests.Timeout):
            pass
        else:
            return json.loads(response.content, parse_float=Decimal)
        wait = _retry_wait(response, attempt)
        if attempt == _ATTEMPTS - 1 or wait > _MAX_RETRY_WAIT:
            if rate_limited:
                raise YahooRateLimited("Yahoo rate limit reached. Rerun later to resume.")
            raise ValueError("Yahoo chart temporarily unavailable.")
        time.sleep(wait)


def fetch_bars(http, symbol, start, end):
    data = _chart(http, symbol, start, end)
    fetched_at = datetime.now(timezone.utc)
    result = (data["chart"]["result"] or [None])[0]
    if result is None:
        raise ValueError("Yahoo returned no daily chart.")
    meta = result["meta"]
    if meta["symbol"] != _yahoo_symbol(symbol) or meta["dataGranularity"] != "1d":
        raise ValueError("Yahoo returned an unexpected symbol or interval.")
    exchange_zone = ZoneInfo(meta["exchangeTimezoneName"])
    series = result["indicators"]["quote"][0]
    bars = {}
    for stamp, *values in zip(result["timestamp"], *(series[field] for field in _FIELDS), strict=True):
        day = datetime.fromtimestamp(stamp, exchange_zone).date()
        if not start <= day <= end or not is_nyse_trading_day(day) or any(value is None for value in values):
            continue
        # Yahoo chart OHLC is split-adjusted. The dividend-adjusted close is separate.
        prices = [Decimal(str(value)) for value in values[:4]]
        volume = Decimal(str(values[4]))
        if not volume.is_finite() or not 0 <= volume < Decimal("1e24"):
            continue
        if not all(price.is_finite() and 0 < price < Decimal("1e12") for price in prices):
            continue
        prices = [price.quantize(PRICE_QUANTUM) for price in prices]
        bar = Bar(symbol, day, *prices, volume, _PROVIDER, fetched_at)
        if fails_price_checks(bar):
            continue
        if day in bars:
            raise ValueError("Yahoo returned duplicate session dates.")
        bars[day] = bar
    if not bars:
        raise ValueError("Yahoo returned no usable bars in the requested window.")
    return [bars[day] for day in sorted(bars)]


def _insert(db, model):
    return (sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert)(model)


def _load_universe(db, requested):
    constituents = {row["ticker"]: row["security"] for row in load_sp500_constituents()}
    proxies = {item["symbol"]: item.get("name") or item["sector"] for item in INDEX_SYMBOLS + SECTOR_SYMBOLS}
    held = set(db.scalars(select(Asset.symbol).join(Holding).where(Holding.quantity > 0, Asset.asset_type == "stock").distinct()))
    watched = set(db.scalars(select(WatchlistItem.symbol).distinct()))
    identities = {**constituents, **proxies}
    for symbol in held | watched:
        identities.setdefault(symbol, symbol)
    if requested is not None:
        identities = {symbol: identities.get(symbol, symbol) for symbol in requested}

    rows = []
    for symbol, name in sorted(identities.items()):
        if not _SYMBOL.fullmatch(symbol):
            continue
        metadata = FEATURED_METADATA.get(symbol, {})
        rows.append({
            "symbol": symbol,
            "company_name": name[:255],
            "exchange": "US",
            "is_etf": symbol in proxies,
            "is_test": False,
            "is_active": True,
            "refresh_tier": "hot" if symbol in HOT_SYMBOLS else "daily",
            "sector": metadata.get("sector"),
            "heatmap_size": metadata.get("heatmap_size", "micro"),
            "source": "sp500_constituents" if symbol in constituents else "yahoo",
        })
    if not rows:
        return {}
    db.execute(_insert(db, MarketSymbol).values(rows).on_conflict_do_nothing(index_elements=["symbol"]))
    symbols = db.scalars(select(MarketSymbol.symbol).where(
        MarketSymbol.symbol.in_([row["symbol"] for row in rows]), MarketSymbol.is_test.is_(False)
    ))
    # Finish index/sector proxies, held/watchlist names and liquid stocks early.
    return {symbol: symbol not in HOT_SYMBOLS and symbol not in held and symbol not in watched for symbol in symbols}


def _store_bars(db, bars):
    rows = []
    for index, bar in enumerate(bars):
        recent = bars[max(index - 1, 0):index + 1]
        flagged = check_bars(recent, symbols=[bar.symbol], as_of=bar.day)
        rows.append({
            "symbol": bar.symbol,
            "session_date": bar.day,
            "provider": _PROVIDER,
            "adjustment_type": _ADJUSTMENT,
            "quality_status": "flagged" if flagged else "valid",
            "fetched_at": bar.fetched_at,
            **{field: getattr(bar, field) for field in _FIELDS},
        })
    changed = 0
    for offset in range(0, len(rows), 500):
        changed += _upsert_bars(db, rows[offset:offset + 500])
    return changed


def _upsert_bars(db, rows):
    command = _insert(db, MarketBarDaily).values(rows)
    changed_fields = (*_FIELDS, "quality_status")
    command = command.on_conflict_do_update(
        index_elements=["symbol", "session_date", "provider", "adjustment_type"],
        set_={field: getattr(command.excluded, field) for field in (*changed_fields, "fetched_at")},
        where=(
            (MarketBarDaily.fetched_at <= command.excluded.fetched_at)
            & tuple_(*(getattr(MarketBarDaily, field) for field in changed_fields)).is_distinct_from(
                tuple_(*(getattr(command.excluded, field) for field in changed_fields))
            )
        ),
    ).returning(MarketBarDaily.session_date)
    return sum(1 for _ in db.scalars(command))


def _store_latest_quote(db, bar):
    if bar.volume >= 2 ** 63:
        return
    # Reuse the existing Yahoo quote's open-to-close change and label.
    quote = EodQuote(bar.symbol, bar.day, bar.open, bar.high, bar.low, bar.close, int(bar.volume))
    _write_quote_cache(
        db, quote.symbol, quote.as_quote(), _PROVIDER, None,
        only_advance_source=True, fetched_at=bar.fetched_at,
    )


def refresh_yahoo_history(db, *, symbols=None, today: date | None = None, force=False, refresh_quotes=False, on_symbol=None):
    """Commit each symbol independently. A rerun resumes from stored sessions."""
    today = nyse_calendar_today() if today is None else today
    start, end = two_calendar_years_before(today), latest_finished_nyse_session(today)
    priorities = _load_universe(db, symbols)
    spans = {
        symbol: (oldest, newest)
        for symbol, oldest, newest in db.execute(
            select(MarketBarDaily.symbol, func.min(MarketBarDaily.session_date), func.max(MarketBarDaily.session_date))
            .where(
                MarketBarDaily.provider == _PROVIDER,
                MarketBarDaily.adjustment_type == _ADJUSTMENT,
                MarketBarDaily.symbol.in_(priorities),
                MarketBarDaily.session_date <= end,
                MarketBarDaily.quality_status.in_(("valid", "flagged")),
            ).group_by(MarketBarDaily.symbol)
        )
    }
    if refresh_quotes:
        current_bars = db.scalars(
            select(MarketBarDaily)
            .outerjoin(MarketQuoteCache, MarketQuoteCache.symbol == MarketBarDaily.symbol)
            .where(
                MarketBarDaily.provider == _PROVIDER,
                MarketBarDaily.adjustment_type == _ADJUSTMENT,
                MarketBarDaily.symbol.in_(priorities),
                MarketBarDaily.session_date == end,
                MarketBarDaily.quality_status == "valid",
                or_(MarketQuoteCache.symbol.is_(None), (
                    (MarketQuoteCache.source == _PROVIDER)
                    & or_(MarketQuoteCache.quote_at.is_(None), MarketQuoteCache.quote_at < datetime.combine(end, midnight()))
                )),
            )
        ).all()
        for row in current_bars:
            _store_latest_quote(db, Bar(
                row.symbol, row.session_date, row.open, row.high, row.low, row.close, row.volume, row.provider,
                datetime.now(timezone.utc),
            ))
    db.commit()

    # Sort by oldest watermark first so throttled runs make progress across the universe.
    pending = sorted(
        (symbol for symbol in priorities if force or spans.get(symbol, (start, date.min))[1] != end),
        key=lambda symbol: (spans.get(symbol, (start, date.min))[1], priorities[symbol], symbol),
    )
    report = {
        "provider": _PROVIDER, "adjustment_type": _ADJUSTMENT, "target_session": end.isoformat(),
        "symbols": len(priorities), "up_to_date": len(priorities) - len(pending),
        "processed": 0, "rows_changed": 0, "errors": [], "rate_limited": False,
    }
    with requests.Session() as http:
        http.headers.update(REQUEST_HEADERS)
        for symbol in pending:
            try:
                # A new split can restate every older Yahoo price in the window.
                oldest = spans.get(symbol, (start, end))[0]
                bars = fetch_bars(http, symbol, min(start, oldest), end)
                changed = _store_bars(db, bars)
                if (refresh_quotes and bars[-1].day == end
                        and not check_bars(bars[-2:], symbols=[symbol], as_of=end)):
                    _store_latest_quote(db, bars[-1])
                db.commit()
                report["rows_changed"] += changed
                detail = None if bars[-1].day == end else "Latest completed session was not returned."
            except YahooRateLimited as exc:
                report["rate_limited"] = True
                report["errors"].append({"symbol": symbol, "detail": str(exc)})
                break
            except (requests.RequestException, ValueError, KeyError, TypeError, IndexError,
                    ArithmeticError, OSError, ZoneInfoNotFoundError) as exc:
                db.rollback()
                detail = f"Yahoo daily chart could not be loaded ({type(exc).__name__})."
            if detail:
                report["errors"].append({"symbol": symbol, "detail": detail})
            report["processed"] += 1
            if on_symbol is not None:
                on_symbol(symbol, detail, report["processed"], len(pending))
    return report
