from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.security import get_current_user, get_current_trader
from app.models.user import User
from app.models.holding import Holding
from app.models.asset import Asset
from app.models.trade import Trade
from app.models.lot import Lot
from app.models.ledger_entry import LedgerEntry
from app.models.order import Order
from app.services.trade_execution import reserved_cash
from app.services.ledger_service import append_reset, ensure_opening
from app.services.price_service import get_live_price

router = APIRouter(dependencies=[Depends(get_current_user)])


def _money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


@router.get("/")
def get_portfolio(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id = current_user.id

    # ----------------------------
    # Unrealized P&L from holdings
    # ----------------------------
    stmt = (
        select(Holding, Asset)
        .join(Asset, Holding.asset_id == Asset.id)
        .where(Holding.user_id == user_id)
    )

    rows = db.execute(stmt).all()

    positions = []
    total_value = Decimal(0)
    total_cost_basis = Decimal(0)

    for holding, asset in rows:
        qty = holding.quantity
        avg_cost = holding.avg_cost

        try:
            current_price = Decimal(str(get_live_price(asset.symbol, asset.asset_type)))
            if not current_price.is_finite() or current_price <= 0:
                raise ValueError("Invalid price quote.")
        except (ValueError, InvalidOperation) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        position_value = qty * current_price
        cost_basis = qty * avg_cost
        unrealized_pnl = position_value - cost_basis
        unrealized_pnl_pct = (unrealized_pnl / cost_basis * 100) if cost_basis > 0 else Decimal(0)

        total_value += position_value
        total_cost_basis += cost_basis

        positions.append({
            "symbol": asset.symbol,
            "asset_type": asset.asset_type,
            "quantity": float(qty),
            "avg_cost": float(avg_cost.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
            "current_price": float(current_price.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
            "position_value": _money(position_value),
            "cost_basis": _money(cost_basis),
            "unrealized_pnl": _money(unrealized_pnl),
            "unrealized_pnl_pct": _money(unrealized_pnl_pct),
        })

    total_unrealized_pnl = total_value - total_cost_basis
    total_unrealized_pnl_pct = (total_unrealized_pnl / total_cost_basis * 100) if total_cost_basis > 0 else Decimal(0)

    # ----------------------------
    # Realized P&L from SELL trades
    # ----------------------------
    # Only works if your Trade model has realized_pnl filled on sells (FIFO)
    latest_reset_id = db.execute(
        select(func.max(LedgerEntry.id)).where(
            LedgerEntry.user_id == user_id, LedgerEntry.event_kind == "reset"
        )
    ).scalar_one()
    realized_stmt = select(func.coalesce(func.sum(Trade.realized_pnl), 0)).where(
        Trade.user_id == user_id, Trade.side == "sell"
    )
    if latest_reset_id is not None:
        realized_stmt = realized_stmt.where(Trade.id.in_(
            select(LedgerEntry.trade_id).where(
                LedgerEntry.user_id == user_id,
                LedgerEntry.event_kind == "trade",
                LedgerEntry.id > latest_reset_id,
            )
        ))
    realized_sum = db.execute(realized_stmt).scalar_one()

    # Total P&L (simple: realized + unrealized)
    total_pnl = Decimal(realized_sum) + total_unrealized_pnl
    cash_balance = current_user.cash_balance
    total_account_value = cash_balance + total_value

    return {
        "user": {"id": current_user.id, "email": current_user.email},
        "positions": positions,
        "summary": {
            "cash_balance": _money(cash_balance),
            "buying_power": _money(cash_balance - reserved_cash(db, user_id)),
            "total_account_value": _money(total_account_value),
            "total_portfolio_value": _money(total_value),
            "total_cost_basis": _money(total_cost_basis),

            "total_unrealized_pnl": _money(total_unrealized_pnl),
            "total_unrealized_pnl_pct": _money(total_unrealized_pnl_pct),

            "total_realized_pnl": _money(Decimal(realized_sum)),
            "total_pnl": _money(total_pnl),
        }
    }


@router.post("/reset")
def reset_portfolio(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_trader),
):
    user_id = current_user.id

    current_user = db.execute(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()
    if db.execute(select(Order.id).where(Order.user_id == user_id, Order.status == "open").limit(1)).first():
        raise HTTPException(status_code=400, detail="Cancel open orders before resetting the portfolio")
    ensure_opening(db, current_user)
    append_reset(db, current_user, Decimal("100000.00"))

    db.query(Lot).filter(Lot.user_id == user_id).delete(synchronize_session=False)
    db.query(Holding).filter(Holding.user_id == user_id).delete(synchronize_session=False)

    current_user.cash_balance = 100000
    db.commit()

    return {
        "cash_balance": 100000.0,
        "buying_power": 100000.0,
        "total_account_value": 100000.0,
    }
