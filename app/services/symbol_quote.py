"""Read-only identity and end-of-day quote for one supported symbol.

The supported set is the S&P 500 constituent file plus SPY, QQQ, DIA, and IWM.
Nothing here calls a market-data provider or writes a row.
"""

import re
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.services.sector_classifier import infer_sector
from app.services.sp500_constituents import load_sp500_constituents

INDEX_ETFS = frozenset({"SPY", "QQQ", "DIA", "IWM"})
_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,19}$")


def _supported_symbols() -> frozenset[str]:
    symbols = {
        str(row["ticker"]).upper()
        for row in load_sp500_constituents()
        if row.get("ticker")
    }
    return frozenset(symbols | INDEX_ETFS)


SUPPORTED_DETAIL_SYMBOLS = _supported_symbols()


def _normalize(symbol: str) -> str:
    if not isinstance(symbol, str) or symbol == "" or symbol != symbol.strip() or len(symbol) > 20:
        raise HTTPException(
            status_code=422,
            detail="symbol must be a nonempty unpadded value of at most 20 characters.",
        )
    normalized = symbol.upper()
    if _SYMBOL_RE.fullmatch(normalized) is None:
        raise HTTPException(
            status_code=422,
            detail="symbol must use letters, digits, dots, or hyphens.",
        )
    return normalized


def _iso_z(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _float_or_none(value: object) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def detail_available_symbols(db: Session, symbols) -> frozenset[str]:
    """Return the given symbols that `read_symbol_quote` can serve.

    Responses that link to the detail page use this so a link never leads to a 404:
    the symbol must be in the supported set and have a symbol row, the same two
    checks the quote read makes.
    """
    candidates = {
        symbol.upper()
        for symbol in symbols
        if isinstance(symbol, str) and symbol.upper() in SUPPORTED_DETAIL_SYMBOLS
    }
    if not candidates:
        return frozenset()
    rows = db.execute(
        select(MarketSymbol.symbol).where(MarketSymbol.symbol.in_(candidates))
    )
    return frozenset(row.symbol for row in rows)


def read_symbol_quote(db: Session, symbol: str) -> dict:
    normalized = _normalize(symbol)
    if normalized not in SUPPORTED_DETAIL_SYMBOLS:
        raise HTTPException(status_code=404, detail="Symbol is outside the supported universe.")
    with consistent_read(db):
        row = db.execute(
            select(MarketSymbol).where(MarketSymbol.symbol == normalized)
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Unknown symbol.")
        quote = db.get(MarketQuoteCache, normalized)
        sector = infer_sector(row.symbol, row.company_name, row.sector)
        body = {
            "symbol": row.symbol,
            "name": row.company_name,
            "sector": sector,
            "exchange": row.exchange,
            "is_etf": bool(row.is_etf),
            "price": None,
            "change_amount": None,
            "change_percent": None,
            "volume": None,
            "source": None,
            "as_of": None,
        }
        if quote is None:
            return body
        body["price"] = _float_or_none(quote.price)
        body["change_amount"] = _float_or_none(quote.change_amount)
        body["change_percent"] = _float_or_none(quote.change_percent)
        body["volume"] = int(quote.volume) if quote.volume is not None else None
        body["source"] = quote.source
        if quote.quote_at is not None:
            body["as_of"] = _iso_z(quote.quote_at)
        return body
