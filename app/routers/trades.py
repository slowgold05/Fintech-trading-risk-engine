from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.asset import Asset
from app.models.user import User
from app.models.trade import Trade
from app.models.holding import Holding
from app.models.lot import Lot
from app.models.risk_assessment import RiskAssessment
from app.models.risk_alert import RiskAlert
from app.schemas.trade import TradeCreate, TradeOut
from app.services.price_service import get_live_price
from app.services.risk_engine import assess_trade_risk

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.post("/", response_model=TradeOut)
def create_trade(
    payload: TradeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id = current_user.id

    symbol = payload.symbol.upper()

    # 1) Get / create asset
    asset = db.execute(
        select(Asset).where(
            Asset.symbol == symbol,
            Asset.asset_type == payload.asset_type
        )
    ).scalar_one_or_none()

    if asset is None:
        asset = Asset(symbol=symbol, asset_type=payload.asset_type, name=None, is_active=True)
        db.add(asset)
        db.flush()

    # 2) Get live price + compute notional
    price = float(get_live_price(symbol, payload.asset_type))
    qty = float(payload.quantity)
    side = payload.side.lower().strip()
    trade_notional = price * qty

    if side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side must be 'buy' or 'sell'")

    # 3) Create trade row
    trade = Trade(
        user_id=user_id,
        asset_id=asset.id,
        side=side,
        quantity=qty,
        price_at_execution=price,
    )
    db.add(trade)
    db.flush()

    # 4) BUY vs SELL handling using LOTS (FIFO)
    holding = db.execute(
        select(Holding).where(Holding.user_id == user_id, Holding.asset_id == asset.id)
    ).scalar_one_or_none()

    if side == "buy":
        # ---- Update holdings (weighted avg) ----
        if holding is None:
            holding = Holding(user_id=user_id, asset_id=asset.id, quantity=qty, avg_cost=price)
            db.add(holding)
        else:
            old_qty = float(holding.quantity)
            old_avg = float(holding.avg_cost)
            new_qty = old_qty + qty
            new_avg = ((old_qty * old_avg) + (qty * price)) / new_qty if new_qty > 0 else 0.0
            holding.quantity = new_qty
            holding.avg_cost = new_avg

        # ---- Create a new LOT for FIFO ----
        lot = Lot(
            user_id=user_id,
            asset_id=asset.id,
            qty_remaining=qty,
            cost_per_unit=price,
        )
        db.add(lot)

        # (Optional) realized pnl stays 0 for buys (if your Trade model has these fields)
        if hasattr(trade, "realized_pnl"):
            trade.realized_pnl = 0.0
        if hasattr(trade, "realized_pnl_pct"):
            trade.realized_pnl_pct = 0.0

    else:
        # ---- SELL: FIFO consume lots + realized P&L ----
        if holding is None or float(holding.quantity) < qty:
            raise HTTPException(status_code=400, detail="Not enough holdings to sell")

        lots = db.execute(
            select(Lot)
            .where(
                Lot.user_id == user_id,
                Lot.asset_id == asset.id,
                Lot.qty_remaining > 0
            )
            .order_by(Lot.created_at.asc(), Lot.id.asc())
        ).scalars().all()

        remaining_to_sell = qty
        realized_pnl = 0.0
        cost_basis_sold = 0.0

        for l in lots:
            if remaining_to_sell <= 0:
                break

            take = min(float(l.qty_remaining), remaining_to_sell)
            lot_cost = float(l.cost_per_unit)

            realized_pnl += (price - lot_cost) * take
            cost_basis_sold += lot_cost * take

            l.qty_remaining = float(l.qty_remaining) - take
            remaining_to_sell -= take

        if remaining_to_sell > 0:
            # Should not happen if holding quantity check passed, but protects from data drift
            raise HTTPException(status_code=500, detail="Lot consumption mismatch")

        # Reduce holding quantity
        holding.quantity = float(holding.quantity) - qty

        # Recompute avg_cost from remaining lots (weighted avg of remaining qty)
        remaining_lots = db.execute(
            select(Lot).where(
                Lot.user_id == user_id,
                Lot.asset_id == asset.id,
                Lot.qty_remaining > 0
            )
        ).scalars().all()

        if float(holding.quantity) <= 0:
            holding.quantity = 0.0
            holding.avg_cost = 0.0
        else:
            total_qty = sum(float(x.qty_remaining) for x in remaining_lots)
            total_cost = sum(float(x.qty_remaining) * float(x.cost_per_unit) for x in remaining_lots)
            holding.avg_cost = (total_cost / total_qty) if total_qty > 0 else 0.0

        # Store realized pnl on trade (if fields exist)
        if hasattr(trade, "realized_pnl"):
            trade.realized_pnl = realized_pnl
        if hasattr(trade, "realized_pnl_pct"):
            trade.realized_pnl_pct = (realized_pnl / cost_basis_sold * 100.0) if cost_basis_sold > 0 else 0.0

    # 5) Risk scoring (same as before)
    score, alerts = assess_trade_risk(db, user_id, trade_notional)

    assessment = RiskAssessment(trade_id=trade.id, user_id=user_id, risk_score=score)
    db.add(assessment)
    db.flush()

    for a in alerts:
        db.add(RiskAlert(
            assessment_id=assessment.id,
            rule_code=a["rule_code"],
            severity=a["severity"],
            reason=a["reason"],
        ))

    db.commit()
    return {"trade_id": trade.id, "risk_score": score}
