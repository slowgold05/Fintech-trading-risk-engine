"""Security and sector weights over one portfolio valuation.

Dollar amounts are decimal text at cents. Weights are decimal text at four
places, ROUND_HALF_UP. An incomplete valuation keeps each position's value and
price status, and nulls every weight, including the sector list.
"""

from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read
from app.models.market_symbol import MarketSymbol
from app.services.portfolio_valuation import _value_portfolio
from app.services.sector_classifier import SECTOR_ORDER, infer_sector

CENT = Decimal("0.01")
WEIGHT_UNIT = Decimal("0.0001")
_SECTOR_RANK = {name: index for index, name in enumerate(SECTOR_ORDER)}


def _cents(value: object) -> Decimal:
    """Recover a cent-quantized amount from the valuation's JSON float."""
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def _cents_text(value: Decimal) -> str:
    return format(value, "f")


def _weight_text(numerator: Decimal, denominator: Decimal) -> str:
    # A zero account has no defined share of itself. Report a measured zero
    # instead of dividing by zero; there are no holdings in that case.
    if denominator == 0:
        quantized = Decimal("0.0000")
    else:
        quantized = (numerator / denominator * 100).quantize(WEIGHT_UNIT, rounding=ROUND_HALF_UP)
    return format(quantized, "f")


def _symbol_profiles(db: Session, symbols: list[str]) -> dict[str, tuple[str | None, str | None]]:
    if not symbols:
        return {}
    rows = db.execute(
        select(MarketSymbol.symbol, MarketSymbol.company_name, MarketSymbol.sector).where(
            MarketSymbol.symbol.in_(symbols)
        )
    ).all()
    return {row.symbol: (row.company_name, row.sector) for row in rows}


def _classified_positions(db: Session, positions: list[dict]) -> list[dict]:
    profiles = _symbol_profiles(db, [position["symbol"] for position in positions])
    classified = []
    for position in positions:
        company_name, existing_sector = profiles.get(position["symbol"], (None, None))
        sector = infer_sector(position["symbol"], company_name, existing_sector) or "Other"
        raw_value = position["position_value"]
        classified.append(
            {
                "symbol": position["symbol"],
                "sector": sector,
                "position_value": None if raw_value is None else _cents(raw_value),
                "price_status": position["price_status"],
            }
        )
    return classified


def _security_payload(item: dict, weight_pct: str | None) -> dict:
    position_value = item["position_value"]
    return {
        "symbol": item["symbol"],
        "sector": item["sector"],
        "position_value": None if position_value is None else _cents_text(position_value),
        "weight_pct": weight_pct,
        "price_status": item["price_status"],
    }


def _sector_payloads(classified: list[dict], total: Decimal) -> list[dict]:
    totals: dict[str, Decimal] = {}
    for item in classified:
        position_value = item["position_value"]
        if position_value is None:
            continue
        totals[item["sector"]] = totals.get(item["sector"], Decimal(0)) + position_value

    payloads = []
    # SECTOR_ORDER rank first. A name outside that list stays visible after Other.
    ranked = sorted(totals.items(), key=lambda pair: (_SECTOR_RANK.get(pair[0], len(SECTOR_ORDER)), pair[0]))
    for sector, raw_value in ranked:
        value = raw_value.quantize(CENT, rounding=ROUND_HALF_UP)
        if value == 0:
            continue
        payloads.append(
            {
                "sector": sector,
                "value": _cents_text(value),
                "weight_pct": _weight_text(value, total),
            }
        )
    return payloads


def allocation_from_portfolio(db: Session, portfolio: dict) -> dict:
    """Classify one valuation. The caller owns the snapshot transaction."""
    summary = portfolio["summary"]
    classified = _classified_positions(db, portfolio["positions"])
    cash_balance = _cents(summary["cash_balance"])
    # Same snapshot instant the valuation already formatted. Not a second clock.
    response = {
        "user": portfolio["user"],
        "read_at": portfolio["snapshot_read_at"],
        "status": "incomplete",
        "cash_balance": _cents_text(cash_balance),
        "cash_weight_pct": None,
        "total_account_value": None,
        "unavailable_symbols": portfolio["unavailable_symbols"],
        "securities": [_security_payload(item, None) for item in classified],
        "sectors": None,
    }
    if summary["total_account_value"] is None:
        return response

    total = _cents(summary["total_account_value"])
    response["status"] = "complete"
    response["cash_weight_pct"] = _weight_text(cash_balance, total)
    response["total_account_value"] = _cents_text(total)
    response["securities"] = [
        _security_payload(
            item,
            None if item["position_value"] is None else _weight_text(item["position_value"], total),
        )
        for item in classified
    ]
    response["sectors"] = _sector_payloads(classified, total)
    return response


def build_allocation_response(db: Session, user_id: int, email: str) -> dict:
    """Public allocation read. Its snapshot is not shared with other callers."""
    with consistent_read(db):
        portfolio = _value_portfolio(db, user_id, email)
        return allocation_from_portfolio(db, portfolio)
