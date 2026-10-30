from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.security import get_current_user, get_current_trader
from app.models.asset import Asset
from app.models.order import Order
from app.models.user import User
from app.models.market_symbol import MarketSymbol
from app.schemas.order import OrderCreate
from app.services.order_book import cancel_order, place_order
from app.services.idempotency import execute_once


router = APIRouter(dependencies=[Depends(get_current_user)])


def _order_out(order: Order, symbol: str) -> dict:
    return {"id": order.id, "symbol": symbol, "side": order.side, "order_type": order.order_type, "quantity": order.quantity,
            "remaining_quantity": order.remaining_quantity, "limit_price": order.limit_price,
            "status": order.status, "created_at": order.created_at}


@router.get("/book/{symbol}")
def get_book(symbol: str, limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)):
    symbol = symbol.strip().upper()
    if not db.execute(select(MarketSymbol.symbol).where(MarketSymbol.symbol == symbol, MarketSymbol.is_active.is_(True))).first():
        return {"symbol": symbol, "bids": [], "asks": []}
    asset = db.execute(select(Asset).where(Asset.symbol == symbol, Asset.asset_type == "stock")).scalar_one_or_none()
    if asset is None:
        return {"symbol": symbol, "bids": [], "asks": []}
    sides = {}
    for side, key, price_order in (("buy", "bids", Order.limit_price.desc()), ("sell", "asks", Order.limit_price.asc())):
        rows = db.execute(select(Order).where(Order.asset_id == asset.id, Order.side == side, Order.status == "open")
                          .order_by(price_order, Order.id.asc()).limit(limit)).scalars()
        sides[key] = [{"price": row.limit_price, "quantity": row.remaining_quantity} for row in rows]
    return {"symbol": symbol, **sides}


@router.get("/")
def list_orders(limit: int = Query(default=50, ge=1, le=100), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.execute(
        select(Order, Asset.symbol).join(Asset, Order.asset_id == Asset.id)
        .where(Order.user_id == current_user.id).order_by(Order.id.desc()).limit(limit)
    ).all()
    return {"orders": [_order_out(order, symbol) for order, symbol in rows]}


@router.post("/")
@limiter.limit("60/minute")
def create_order(request: Request, payload: OrderCreate,
                 idempotency_key: str = Header(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"),
                 db: Session = Depends(get_db), current_user: User = Depends(get_current_trader)):
    def execute() -> dict:
        order, trade_ids = place_order(db, current_user.id, payload)
        asset = db.get(Asset, order.asset_id)
        return {**_order_out(order, asset.symbol), "trade_ids": trade_ids}

    return execute_once(db, current_user.id, idempotency_key, "order", payload, execute)


@router.post("/{order_id}/cancel")
@limiter.limit("60/minute")
def cancel(request: Request, order_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_trader)):
    try:
        order = cancel_order(db, current_user.id, order_id)
        db.commit()
        asset = db.get(Asset, order.asset_id)
        return _order_out(order, asset.symbol)
    except Exception:
        db.rollback()
        raise
