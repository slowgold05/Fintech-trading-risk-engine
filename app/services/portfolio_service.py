from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.holding import Holding


def apply_trade_to_holdings(db: Session, user_id: int, asset_id: int, side: str, qty: float, price: float):
    stmt = select(Holding).where(Holding.user_id == user_id, Holding.asset_id == asset_id)
    holding = db.execute(stmt).scalar_one_or_none()

    if holding is None:
        holding = Holding(user_id=user_id, asset_id=asset_id, quantity=0, avg_cost=0)
        db.add(holding)
        db.flush()

    if side == "buy":
        new_qty = float(holding.quantity) + qty
        # weighted average cost
        if new_qty > 0:
            holding.avg_cost = ((float(holding.avg_cost) * float(holding.quantity)) + (qty * price)) / new_qty
        holding.quantity = new_qty
    else:
        holding.quantity = float(holding.quantity) - qty
        if float(holding.quantity) < 0:
            holding.quantity = 0  # keep simple for now
