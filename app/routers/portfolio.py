from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.holding import Holding
from app.models.asset import Asset
from app.models.trade import Trade
from app.services.price_service import get_live_price

router = APIRouter(dependencies=[Depends(get_current_user)])


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
    total_value = 0.0
    total_cost_basis = 0.0

    for holding, asset in rows:
        qty = float(holding.quantity)
        avg_cost = float(holding.avg_cost)

        current_price = float(get_live_price(asset.symbol, asset.asset_type))

        position_value = qty * current_price
        cost_basis = qty * avg_cost
        unrealized_pnl = position_value - cost_basis
        unrealized_pnl_pct = (unrealized_pnl / cost_basis * 100.0) if cost_basis > 0 else 0.0

        total_value += position_value
        total_cost_basis += cost_basis

        positions.append({
            "symbol": asset.symbol,
            "asset_type": asset.asset_type,
            "quantity": round(qty, 8),
            "avg_cost": round(avg_cost, 4),
            "current_price": round(current_price, 4),
            "position_value": round(position_value, 2),
            "cost_basis": round(cost_basis, 2),
            "unrealized_pnl": round(unrealized_pnl, 2),
            "unrealized_pnl_pct": round(unrealized_pnl_pct, 2),
        })

    total_unrealized_pnl = total_value - total_cost_basis
    total_unrealized_pnl_pct = (total_unrealized_pnl / total_cost_basis * 100.0) if total_cost_basis > 0 else 0.0

    # ----------------------------
    # Realized P&L from SELL trades
    # ----------------------------
    # Only works if your Trade model has realized_pnl filled on sells (FIFO)
    realized_sum = db.execute(
        select(func.coalesce(func.sum(Trade.realized_pnl), 0.0))
        .where(Trade.user_id == user_id, Trade.side == "sell")
    ).scalar_one()

    # Total P&L (simple: realized + unrealized)
    total_pnl = float(realized_sum) + float(total_unrealized_pnl)

    return {
        "user": {"id": current_user.id, "email": current_user.email},
        "positions": positions,
        "summary": {
            "total_portfolio_value": round(total_value, 2),
            "total_cost_basis": round(total_cost_basis, 2),

            "total_unrealized_pnl": round(total_unrealized_pnl, 2),
            "total_unrealized_pnl_pct": round(total_unrealized_pnl_pct, 2),

            "total_realized_pnl": round(float(realized_sum), 2),
            "total_pnl": round(float(total_pnl), 2),
        }
    }
