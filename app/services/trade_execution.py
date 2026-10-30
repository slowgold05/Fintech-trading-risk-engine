from decimal import Decimal, ROUND_HALF_UP, localcontext

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.lot import Lot
from app.models.order import Order
from app.models.risk_alert import RiskAlert
from app.models.risk_assessment import RiskAssessment
from app.models.trade import Trade
from app.models.user import User
from app.services.ledger_service import append_trade, ensure_opening
from app.services.risk_engine import assess_trade_risk


CENT = Decimal("0.01")
SIX_PLACES = Decimal("0.000001")


def notional_amount(qty: Decimal, price: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = 50
        return (qty * price).quantize(CENT, rounding=ROUND_HALF_UP)


def reserved_cash(db: Session, user_id: int) -> Decimal:
    orders = db.execute(select(Order).where(Order.user_id == user_id, Order.side == "buy", Order.status == "open")).scalars()
    return sum((notional_amount(order.remaining_quantity, order.limit_price) for order in orders), Decimal(0))


def reserved_shares(db: Session, user_id: int, asset_id: int) -> Decimal:
    orders = db.execute(select(Order).where(Order.user_id == user_id, Order.asset_id == asset_id, Order.side == "sell", Order.status == "open")).scalars()
    return sum((order.remaining_quantity for order in orders), Decimal(0))


def execute_fill(db: Session, user: User, asset: Asset, side: str, qty: Decimal, price: Decimal, order_id: int | None = None) -> tuple[Trade, int]:
    if side not in ("buy", "sell") or qty <= 0 or price <= 0:
        raise ValueError("Invalid trade fill")
    notional = notional_amount(qty, price)
    if notional <= 0:
        raise HTTPException(status_code=400, detail="Trade value must be at least $0.01")
    if side == "buy" and notional > user.cash_balance:
        raise HTTPException(status_code=400, detail="Insufficient buying power")

    holding = db.execute(
        select(Holding).where(Holding.user_id == user.id, Holding.asset_id == asset.id)
    ).scalar_one_or_none()
    if side == "sell" and (holding is None or holding.quantity < qty):
        raise HTTPException(status_code=400, detail="Not enough holdings to sell")

    ensure_opening(db, user)
    trade = Trade(user_id=user.id, asset_id=asset.id, order_id=order_id, side=side, quantity=qty, price_at_execution=price)
    db.add(trade)
    db.flush()

    if side == "buy":
        if holding is None:
            holding = Holding(user_id=user.id, asset_id=asset.id, quantity=qty, avg_cost=price)
            db.add(holding)
        else:
            old_qty = holding.quantity
            holding.quantity += qty
            holding.avg_cost = ((old_qty * holding.avg_cost + qty * price) / holding.quantity).quantize(
                SIX_PLACES, rounding=ROUND_HALF_UP
            )
        db.add(Lot(user_id=user.id, asset_id=asset.id, qty_remaining=qty, cost_per_unit=price))
        trade.realized_pnl = Decimal(0)
        trade.realized_pnl_pct = Decimal(0)
        user.cash_balance -= notional
    else:
        lots = db.execute(
            select(Lot)
            .where(Lot.user_id == user.id, Lot.asset_id == asset.id, Lot.qty_remaining > 0)
            .order_by(Lot.created_at.asc(), Lot.id.asc())
        ).scalars().all()
        remaining = qty
        realized_pnl = Decimal(0)
        cost_basis = Decimal(0)
        for lot in lots:
            if remaining <= 0:
                break
            take = min(lot.qty_remaining, remaining)
            realized_pnl += (price - lot.cost_per_unit) * take
            cost_basis += lot.cost_per_unit * take
            lot.qty_remaining -= take
            remaining -= take
        if remaining > 0:
            raise HTTPException(status_code=500, detail="Lot consumption mismatch")

        holding.quantity -= qty
        if holding.quantity == 0:
            holding.avg_cost = Decimal(0)
        else:
            total_qty = sum(lot.qty_remaining for lot in lots)
            total_cost = sum(lot.qty_remaining * lot.cost_per_unit for lot in lots)
            if total_qty != holding.quantity:
                raise HTTPException(status_code=500, detail="Lot consumption mismatch")
            holding.avg_cost = (total_cost / total_qty).quantize(SIX_PLACES, rounding=ROUND_HALF_UP)
        trade.realized_pnl = realized_pnl.quantize(CENT, rounding=ROUND_HALF_UP)
        trade.realized_pnl_pct = (
            (realized_pnl / cost_basis * 100).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            if cost_basis > 0 else Decimal(0)
        )
        user.cash_balance += notional

    append_trade(db, user.id, trade.id, asset.id, side, qty, notional)
    score, alerts = assess_trade_risk(db, user.id, notional)
    assessment = RiskAssessment(trade_id=trade.id, user_id=user.id, risk_score=score)
    db.add(assessment)
    db.flush()
    for alert in alerts:
        db.add(RiskAlert(
            assessment_id=assessment.id,
            rule_code=alert["rule_code"],
            severity=alert["severity"],
            reason=alert["reason"],
        ))
    return trade, score
