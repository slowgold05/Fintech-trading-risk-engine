"""Price, market cap, and P/E for the company research panel.

Price comes from the latest Massive row in the quote cache. Market cap is that
price times shares outstanding. Share count comes from the Massive ticker
reference endpoint, which is on the free plan, and falls back to the SEC dei
cover fact. P/E is the price divided by the trailing four diluted-EPS quarters.
Alpha Vantage is used only when the preferred figure cannot be computed.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_reference_cache import MarketReferenceCache
from app.services.market_providers import ProviderUnavailable
from app.services.massive_client import http_get_massive_ticker
from app.services.price_service import get_stock_quote

_CACHE_HOURS = 24
_EOD_BASIS = "end_of_day_previous_close"
_AV_BASIS = "alpha_vantage"


def _positive(value) -> float | None:
    if isinstance(value, bool) or isinstance(value, (dict, list)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0:
        return None
    return number


def _finite(value) -> float | None:
    number = _positive(value)
    if number is not None:
        return number
    if isinstance(value, bool) or isinstance(value, (dict, list)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def shares_from_ticker_payload(payload: dict) -> tuple[float, str] | None:
    """Weighted shares, then the share class count. Missing or non-positive is None."""
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, dict):
        return None
    weighted = _positive(results.get("weighted_shares_outstanding"))
    if weighted is not None:
        return weighted, "massive_weighted"
    share_class = _positive(results.get("share_class_shares_outstanding"))
    if share_class is not None:
        return share_class, "massive_share_class"
    return None


def _as_date_text(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    return None


def _overview_number(overview: dict, key: str) -> float | None:
    if not isinstance(overview, dict):
        return None
    return _finite(overview.get(key))


def _massive_quote(db: Session, symbol: str) -> dict | None:
    row = db.get(MarketQuoteCache, symbol)
    if row is None or row.source != "massive":
        return None
    price = _positive(row.price)
    if price is None:
        return None
    change = _finite(row.change_percent)
    return {
        "price": price,
        "change_percent": 0.0 if change is None else change,
        "price_basis": _EOD_BASIS,
        "price_as_of": _as_date_text(row.quote_at) or _as_date_text(row.fetched_at),
    }


def _cached_shares(db: Session, symbol: str) -> MarketReferenceCache | None:
    row = db.get(MarketReferenceCache, symbol)
    if row is None or row.fetched_at is None:
        return None
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=_CACHE_HOURS)
    fetched = row.fetched_at
    if fetched.tzinfo is not None:
        fetched = fetched.astimezone(timezone.utc).replace(tzinfo=None)
    if fetched < cutoff:
        return None
    return row


def _store_shares(db: Session, symbol: str, shares: float | None, source: str) -> None:
    row = db.get(MarketReferenceCache, symbol)
    if row is None:
        row = MarketReferenceCache(symbol=symbol, shares_outstanding=None, source=source, fetched_at=datetime.now(timezone.utc).replace(tzinfo=None))
        db.add(row)
    row.shares_outstanding = None if shares is None else Decimal(str(shares))
    row.source = source
    row.fetched_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()


def massive_shares_outstanding(db: Session, symbol: str, *, http_get=None) -> tuple[float | None, str | None, str | None]:
    """Return shares, source, and an error detail. Uses the 24-hour cache.

    ``http_get`` is resolved when the function runs so tests can replace
    ``http_get_massive_ticker`` without a live Massive call.
    """
    fetch = http_get_massive_ticker if http_get is None else http_get
    cached = _cached_shares(db, symbol)
    if cached is not None:
        shares = _positive(cached.shares_outstanding)
        return shares, cached.source, None
    if not settings.massive_api_key.strip():
        return None, None, None
    try:
        payload = fetch(symbol, settings.massive_api_key)
    except ProviderUnavailable as exc:
        return None, None, str(exc)
    parsed = shares_from_ticker_payload(payload if isinstance(payload, dict) else {})
    if parsed is None:
        _store_shares(db, symbol, None, "massive_unavailable")
        return None, "massive_unavailable", None
    shares, source = parsed
    _store_shares(db, symbol, shares, source)
    return shares, source, None


def build_research_valuation(
    db: Session,
    symbol: str,
    overview: dict,
    sec_fundamentals: dict,
    *,
    http_get=None,
    quote_getter=None,
) -> dict:
    """Choose price, market cap, and P/E, and the quote used for scoring.

    ``quote_getter`` is the research router's ``get_stock_quote``. Passing it
    at call time keeps the existing router monkeypatches on the fallback path.
    """
    fetch = http_get_massive_ticker if http_get is None else http_get
    getter = get_stock_quote if quote_getter is None else quote_getter
    errors = []
    quote = _massive_quote(db, symbol)
    if quote is None:
        try:
            live = getter(symbol)
        except ValueError as exc:
            errors.append({"source": "Alpha Vantage quote", "detail": str(exc)})
            live = None
        price = _positive(live.get("price")) if isinstance(live, dict) else None
        change = _finite(live.get("change_percent")) if isinstance(live, dict) else None
        quote = {
            "price": price,
            "change_percent": change,
            "price_basis": _AV_BASIS if price is not None else None,
            "price_as_of": None,
        }

    shares = _positive(sec_fundamentals.get("shares_outstanding")) if isinstance(sec_fundamentals, dict) else None
    shares_source = "sec_dei" if shares is not None else None
    massive_shares, massive_source, massive_error = massive_shares_outstanding(db, symbol, http_get=fetch)
    if massive_error:
        errors.append({"source": "Massive reference", "detail": massive_error})
    if massive_shares is not None:
        shares = massive_shares
        shares_source = massive_source

    price = quote.get("price")
    market_cap = None
    market_cap_basis = None
    if price is not None and shares is not None:
        market_cap = price * shares
        market_cap_basis = "end_of_day_price_times_shares" if quote.get("price_basis") == _EOD_BASIS else "price_times_shares"
    else:
        overview_cap = _positive(_overview_number(overview, "MarketCapitalization"))
        if overview_cap is not None:
            market_cap = overview_cap
            market_cap_basis = _AV_BASIS

    sec = sec_fundamentals if isinstance(sec_fundamentals, dict) else {}
    eps = _finite(sec.get("ttm_diluted_eps")) if "ttm_diluted_eps" in sec else None
    pe_ratio = None
    pe_basis = None
    if "ttm_diluted_eps" in sec:
        # A filing set that does not produce a positive trailing EPS stays blank.
        # Falling back to the overview P/E would show a different number.
        pe_basis = "sec_ttm_diluted_eps"
        if price is not None and eps is not None and eps > 0:
            pe_ratio = price / eps
    else:
        overview_pe = _positive(_overview_number(overview, "PERatio"))
        if overview_pe is not None:
            pe_ratio = overview_pe
            pe_basis = _AV_BASIS

    as_of = quote.get("price_as_of")
    notice = None
    if quote.get("price_basis") == _EOD_BASIS and as_of:
        notice = f"End-of-day previous close as of {as_of}."

    scoring_quote = None
    if price is not None:
        scoring_quote = {"price": price, "change_percent": quote.get("change_percent")}

    return {
        "price": price,
        "change_percent": quote.get("change_percent"),
        "price_basis": quote.get("price_basis"),
        "price_as_of": as_of,
        "market_cap": market_cap,
        "market_cap_basis": market_cap_basis,
        "shares_outstanding": shares,
        "shares_source": shares_source,
        "pe_ratio": pe_ratio,
        "pe_basis": pe_basis,
        "valuation_notice": notice,
        "quote": scoring_quote,
        "errors": errors,
    }
