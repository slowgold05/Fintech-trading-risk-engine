"""Dollar profit-and-loss attribution by security and sector.

Amounts are decimal text at cents. Contribution percentages are decimal
text at four places, ROUND_HALF_UP, and are not clamped to [0, 100].
An incomplete valuation nulls every percentage and the sector list. A
complete valuation whose net P&L is exactly zero still reports that zero
and nulls every percentage.
"""

from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.market_symbol import MarketSymbol
from app.services.portfolio_valuation import build_portfolio_response
from app.services.sector_classifier import SECTOR_ORDER, infer_sector

CENT = Decimal("0.01")
PCT_UNIT = Decimal("0.0001")
_SECTOR_RANK = {name: index for index, name in enumerate(SECTOR_ORDER)}


def _cents(value: object) -> Decimal:
    """Recover a cent-quantized amount from the valuation's JSON float."""
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def _cents_text(value: Decimal) -> str:
    return format(value, "f")


def _contribution_text(numerator: Decimal, denominator: Decimal) -> str:
    # A loss is a negative share. A gain larger than the net total is over 100.
    quantized = (numerator / denominator * 100).quantize(PCT_UNIT, rounding=ROUND_HALF_UP)
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
        raw_unrealized = position["unrealized_pnl"]
        raw_total = position["total_pnl"]
        classified.append(
            {
                "symbol": position["symbol"],
                "sector": sector,
                "realized_pnl": _cents(position["realized_pnl"]),
                "unrealized_pnl": None if raw_unrealized is None else _cents(raw_unrealized),
                "total_pnl": None if raw_total is None else _cents(raw_total),
            }
        )
    return classified


def _security_payload(item: dict, contribution_pct: str | None) -> dict:
    unrealized = item["unrealized_pnl"]
    total = item["total_pnl"]
    return {
        "symbol": item["symbol"],
        "sector": item["sector"],
        "realized_pnl": _cents_text(item["realized_pnl"]),
        "unrealized_pnl": None if unrealized is None else _cents_text(unrealized),
        "total_pnl": None if total is None else _cents_text(total),
        "pnl_contribution_pct": contribution_pct,
    }


def _sector_payloads(classified: list[dict], total: Decimal, percentages_defined: bool) -> list[dict]:
    totals: dict[str, Decimal] = {}
    for item in classified:
        totals[item["sector"]] = totals.get(item["sector"], Decimal(0)) + item["total_pnl"]

    payloads = []
    # SECTOR_ORDER rank first. A name outside that list stays visible after Other.
    ranked = sorted(totals.items(), key=lambda pair: (_SECTOR_RANK.get(pair[0], len(SECTOR_ORDER)), pair[0]))
    for sector, raw_value in ranked:
        value = raw_value.quantize(CENT, rounding=ROUND_HALF_UP)
        # A sector can net to zero while the account does not. That share is a real 0%.
        contribution = _contribution_text(value, total) if percentages_defined else None
        payloads.append(
            {
                "sector": sector,
                "total_pnl": _cents_text(value),
                "pnl_contribution_pct": contribution,
            }
        )
    return payloads


def build_attribution_response(db: Session, user_id: int, email: str) -> dict:
    portfolio = build_portfolio_response(db, user_id, email)
    classified = _classified_positions(db, portfolio["positions"])
    # Same snapshot instant the valuation already formatted. Not a second clock.
    response = {
        "user": portfolio["user"],
        "read_at": portfolio["snapshot_read_at"],
        "status": "incomplete",
        "total_pnl": None,
        "securities": [_security_payload(item, None) for item in classified],
        "sectors": None,
    }
    if portfolio["valuation_status"] != "complete":
        return response

    total = sum((item["total_pnl"] for item in classified), Decimal(0)).quantize(CENT, rounding=ROUND_HALF_UP)
    # A percentage of a zero net is undefined. The zero itself is still reported.
    percentages_defined = total != 0
    response["status"] = "complete"
    response["total_pnl"] = _cents_text(total)
    response["securities"] = [
        _security_payload(
            item,
            _contribution_text(item["total_pnl"], total) if percentages_defined else None,
        )
        for item in classified
    ]
    response["sectors"] = _sector_payloads(classified, total, percentages_defined)
    return response
