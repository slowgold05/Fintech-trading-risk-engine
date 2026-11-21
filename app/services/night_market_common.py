"""Validation and provenance shared by public Night market reads."""

import re
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.market_symbol import MarketSymbol
from app.schemas.night_market import Coverage

_SYMBOL = re.compile(r"[A-Za-z0-9][A-Za-z0-9.\-]{0,19}", re.ASCII)


def market_error(
    status: int, code: str, message: str, fields: dict[str, str] | None = None
) -> HTTPException:
    detail: dict = {"code": code, "message": message}
    if fields:
        detail["fields"] = fields
    return HTTPException(status_code=status, detail=detail)


def parse_symbol(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    symbol = raw.strip()
    return symbol.upper() if _SYMBOL.fullmatch(symbol) else None


def normalize_symbol(raw: str, field: str = "symbol") -> str:
    symbol = parse_symbol(raw)
    if symbol is None:
        message = "Use 1 to 20 letters, digits, dots, or hyphens for each symbol."
        raise market_error(422, "invalid_request", message, {field: message})
    return symbol


def require_symbols(db: Session, symbols: list[str]) -> None:
    found = set(db.scalars(select(MarketSymbol.symbol).where(MarketSymbol.symbol.in_(symbols))))
    missing = [symbol for symbol in symbols if symbol not in found]
    if missing:
        raise market_error(404, "unknown_symbol", f"Unknown ticker: {', '.join(missing)}.")


def utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def price_return(close: Decimal, base: Decimal) -> Decimal:
    return close / base - Decimal(1)


def counted_coverage(covered: int, total: int) -> Coverage:
    if covered == 0:
        return "missing"
    return "available" if covered == total else "partial"
