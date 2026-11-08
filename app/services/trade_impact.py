"""Hypothetical cash and weight impact of one trade.

Dollar amounts are decimal text at cents. Weights are decimal text at four
places, ROUND_HALF_UP. This preview only reads. It does not create or change
orders, trades, holdings, or ledger rows.

An incomplete allocation still reports cash, buying power, and the traded
symbol's position dollars when that symbol is priced. The account-value
change stays "0.00": the cash leg and the position leg cancel even when the
absolute total is unknown. Totals and weights stay null, because each of
those needs that total. Buying power is the cash balance: this slice has no
margin book and does not subtract open-order reserves.
"""

from decimal import Decimal, ROUND_HALF_UP, localcontext

from sqlalchemy.orm import Session

from app.schemas.trade_impact import TradeImpactRequest
from app.services.portfolio_allocation import build_allocation_response
from app.services.portfolio_valuation import build_portfolio_response

CENT = Decimal("0.01")
WEIGHT_UNIT = Decimal("0.0001")
QUANTITY_UNIT = Decimal("0.000001")


def _cents_text(value: Decimal) -> str:
    return format(value.quantize(CENT, rounding=ROUND_HALF_UP), "f")


def _quantity_text(value: Decimal) -> str:
    return format(value.quantize(QUANTITY_UNIT, rounding=ROUND_HALF_UP), "f")


def _weight_text(numerator: Decimal, denominator: Decimal) -> str:
    # A zero account has no defined share of itself. Same gate as allocation.
    if denominator == 0:
        quantized = Decimal("0.0000")
    else:
        quantized = (numerator / denominator * 100).quantize(WEIGHT_UNIT, rounding=ROUND_HALF_UP)
    return format(quantized, "f")


def _delta_text(after: str | None, before: str | None, unit: Decimal) -> str | None:
    if after is None or before is None:
        return None
    delta = (Decimal(after) - Decimal(before)).quantize(unit, rounding=ROUND_HALF_UP)
    return format(delta, "f")


def _trade_value(quantity: Decimal, price: Decimal) -> Decimal:
    # Same cent rounding a live fill uses for notional. Extra precision keeps
    # a long product from rounding before the cent step.
    with localcontext() as context:
        context.prec = 50
        return (quantity * price).quantize(CENT, rounding=ROUND_HALF_UP)


def _levels(
    cash_balance: str | None,
    buying_power: str | None,
    total_account_value: str | None,
    cash_weight_pct: str | None,
    symbol_position_value: str | None,
    symbol_weight_pct: str | None,
) -> dict:
    return {
        "cash_balance": cash_balance,
        "buying_power": buying_power,
        "total_account_value": total_account_value,
        "cash_weight_pct": cash_weight_pct,
        "symbol_position_value": symbol_position_value,
        "symbol_weight_pct": symbol_weight_pct,
    }


def _changes(before: dict, after: dict) -> dict:
    return {
        "cash_balance": _delta_text(after["cash_balance"], before["cash_balance"], CENT),
        # The cash leg and the position leg are the same trade value with
        # opposite signs. The account total does not move, including when the
        # absolute total itself is unknown and those two levels are null.
        "total_account_value": "0.00",
        "cash_weight_pct": _delta_text(after["cash_weight_pct"], before["cash_weight_pct"], WEIGHT_UNIT),
        "symbol_weight_pct": _delta_text(after["symbol_weight_pct"], before["symbol_weight_pct"], WEIGHT_UNIT),
    }


def _position_before(allocation: dict, symbol: str) -> tuple[Decimal | None, str | None]:
    """Held position dollars. Zero when the symbol is absent, null when unpriced."""
    for entry in allocation["securities"]:
        if entry["symbol"] != symbol:
            continue
        raw_value = entry["position_value"]
        if raw_value is None:
            return None, entry["weight_pct"]
        return Decimal(raw_value), entry["weight_pct"]
    return Decimal("0.00"), None


def _held_quantity(db: Session, user_id: int, email: str, symbol: str) -> Decimal:
    portfolio = build_portfolio_response(db, user_id, email)
    for position in portfolio["positions"]:
        if position["symbol"] != symbol:
            continue
        quantity = position["quantity"]
        if quantity is None:
            return Decimal("0")
        return Decimal(str(quantity))
    return Decimal("0")


def _warnings(
    side: str,
    trade_value: Decimal,
    cash_before: Decimal,
    quantity: Decimal,
    held_quantity: Decimal,
) -> list[str]:
    warnings = []
    if side == "buy" and trade_value > cash_before:
        warnings.append("insufficient_buying_power")
    if side == "sell" and quantity > held_quantity:
        warnings.append("insufficient_shares")
    return warnings


def build_trade_impact_response(
    db: Session,
    user_id: int,
    email: str,
    request: TradeImpactRequest,
) -> dict:
    allocation = build_allocation_response(db, user_id, email)
    cash_before = Decimal(allocation["cash_balance"])
    position_before, published_symbol_weight = _position_before(allocation, request.symbol)
    held_quantity = _held_quantity(db, user_id, email, request.symbol)
    trade_value = _trade_value(request.quantity, request.reference_price)
    warnings = _warnings(request.side, trade_value, cash_before, request.quantity, held_quantity)

    # Cash and the traded position move by the trade value on either status.
    # Neither leg needs the account total.
    if request.side == "buy":
        cash_after = cash_before - trade_value
        position_after = None if position_before is None else position_before + trade_value
    else:
        cash_after = cash_before + trade_value
        position_after = None if position_before is None else position_before - trade_value

    position_before_text = None if position_before is None else _cents_text(position_before)
    position_after_text = None if position_after is None else _cents_text(position_after)

    if allocation["status"] == "complete":
        # A complete valuation prices every held name, so both legs are known.
        assert position_before is not None and position_after is not None
        total_before = Decimal(allocation["total_account_value"])
        # Cash and the position move by the same cent-rounded trade value, so the
        # account total is unchanged. Adding only the cash leg would drop the
        # offsetting position leg and would not match that invariant.
        total_after = total_before + (cash_after - cash_before) + (position_after - position_before)
        assert total_after == total_before
        if published_symbol_weight is None:
            symbol_weight_before = _weight_text(position_before, total_before)
        else:
            symbol_weight_before = published_symbol_weight
        total_before_text = allocation["total_account_value"]
        total_after_text = _cents_text(total_after)
        cash_weight_before = allocation["cash_weight_pct"]
        cash_weight_after = _weight_text(cash_after, total_after)
        symbol_weight_after = _weight_text(position_after, total_after)
        status = "complete"
    else:
        total_before_text = None
        total_after_text = None
        cash_weight_before = None
        cash_weight_after = None
        symbol_weight_before = None
        symbol_weight_after = None
        status = "incomplete"

    before = _levels(
        allocation["cash_balance"],
        allocation["cash_balance"],
        total_before_text,
        cash_weight_before,
        position_before_text,
        symbol_weight_before,
    )
    after = _levels(
        _cents_text(cash_after),
        _cents_text(cash_after),
        total_after_text,
        cash_weight_after,
        position_after_text,
        symbol_weight_after,
    )
    return {
        "user": allocation["user"],
        "read_at": allocation["read_at"],
        "status": status,
        "symbol": request.symbol,
        "side": request.side,
        "quantity": _quantity_text(request.quantity),
        "reference_price": _quantity_text(request.reference_price),
        "order_type": request.order_type,
        "warnings": warnings,
        "before": before,
        "after": after,
        "changes": _changes(before, after),
    }
