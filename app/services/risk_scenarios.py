"""Custom security and sector shock preview.

Dollar amounts are decimal text at cents. The loss percentage is decimal
text at four places, ROUND_HALF_UP. Matching shocks multiply in request
order. Each security is quantized once, after every matching shock, so
rounding does not compound between shocks. Cash is never shocked.

This preview only reads. It does not create or change orders, trades,
holdings, or ledger rows. An incomplete allocation nulls every dollar and
percentage field and still echoes the requested shocks.
"""

from decimal import Decimal, ROUND_HALF_UP, localcontext

from sqlalchemy.orm import Session

from app.schemas.risk_scenarios import RiskScenarioShock, RiskScenariosRequest
from app.services.portfolio_allocation import build_allocation_response

CENT = Decimal("0.01")
FOUR_PLACES = Decimal("0.0001")
_ONE = Decimal(1)
_ONE_HUNDRED = Decimal(100)


def _cents_text(value: Decimal) -> str:
    return format(value.quantize(CENT, rounding=ROUND_HALF_UP), "f")


def _loss_pct_text(loss: Decimal, total_before: Decimal) -> str:
    # A zero account has no defined percentage of itself. Same gate as
    # allocation weights: report a measured zero instead of dividing by zero.
    if total_before == 0:
        quantized = Decimal("0.0000")
    else:
        quantized = (loss / total_before * _ONE_HUNDRED).quantize(
            FOUR_PLACES, rounding=ROUND_HALF_UP
        )
    return format(quantized, "f")


def _shock_payload(shock: RiskScenarioShock) -> dict:
    # Decimal text, not Pydantic's JSON number. Preserve the value's own scale.
    return {
        "target_type": shock.target_type,
        "target": shock.target,
        "shock_pct": format(shock.shock_pct, "f"),
    }


def _matches(shock: RiskScenarioShock, security: dict) -> bool:
    if shock.target_type == "symbol":
        return shock.target == security["symbol"]
    return shock.target == security["sector"]


def _revalue(position_value: Decimal, security: dict, shocks: list[RiskScenarioShock]) -> Decimal:
    """Apply matching shocks in order, then round to cents once."""
    # Extra precision keeps a long product from rounding before the cent step.
    with localcontext() as context:
        context.prec = 50
        value = position_value
        for shock in shocks:
            if _matches(shock, security):
                value *= _ONE + shock.shock_pct / _ONE_HUNDRED
        return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _incomplete(allocation: dict, shocks: list[dict]) -> dict:
    return {
        "user": allocation["user"],
        "read_at": allocation["read_at"],
        "status": "incomplete",
        "shocks": shocks,
        "total_account_value_before": None,
        "total_account_value_after": None,
        "loss": None,
        "loss_pct": None,
        "securities": [],
    }


def build_risk_scenarios_response(
    db: Session,
    user_id: int,
    email: str,
    request: RiskScenariosRequest,
) -> dict:
    allocation = build_allocation_response(db, user_id, email)
    shocks = [_shock_payload(shock) for shock in request.shocks]
    if allocation["status"] != "complete":
        return _incomplete(allocation, shocks)

    cash_balance = Decimal(allocation["cash_balance"])
    total_before = Decimal(allocation["total_account_value"])
    securities = []
    positions_after = Decimal(0)
    for security in allocation["securities"]:
        raw_value = security["position_value"]
        if raw_value is None:
            continue
        before = Decimal(raw_value)
        after = _revalue(before, security, request.shocks)
        positions_after += after
        securities.append(
            {
                "symbol": security["symbol"],
                "sector": security["sector"],
                "position_value_before": _cents_text(before),
                "position_value_after": _cents_text(after),
            }
        )

    total_after = cash_balance + positions_after
    loss = total_before - total_after
    return {
        "user": allocation["user"],
        "read_at": allocation["read_at"],
        "status": "complete",
        "shocks": shocks,
        "total_account_value_before": _cents_text(total_before),
        "total_account_value_after": _cents_text(total_after),
        "loss": _cents_text(loss),
        "loss_pct": _loss_pct_text(loss, total_before),
        "securities": securities,
    }
