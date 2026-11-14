from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.read_snapshot import consistent_read, snapshot_clock
from app.core.security import get_current_user, get_current_trader
from app.models.asset import Asset
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import User
from app.models.market_symbol import MarketSymbol
from app.schemas.order import OrderCreate
from app.services.order_book import cancel_order, place_order
from app.services.idempotency import execute_once
from app.services.order_preview import preview_order
from app.services.order_step_up import order_notional, require_notional_step_up
from app.services.trade_execution import notional_amount


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
def create_order(request: Request, response: Response, payload: OrderCreate,
                 idempotency_key: str = Header(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"),
                 step_up_code: str | None = Header(default=None, alias="X-Step-Up-Code"),
                 db: Session = Depends(get_db), current_user: User = Depends(get_current_trader)):
    def execute() -> dict:
        require_notional_step_up(db, current_user, order_notional(db, payload), step_up_code)
        order, trade_ids = place_order(db, current_user.id, payload)
        asset = db.get(Asset, order.asset_id)
        return {**_order_out(order, asset.symbol), "trade_ids": trade_ids}

    return execute_once(db, current_user.id, idempotency_key, "order", payload, execute)


@router.post("/preview")
@limiter.limit("60/minute")
def preview(request: Request, response: Response, payload: OrderCreate,
            db: Session = Depends(get_db), current_user: User = Depends(get_current_trader)):
    owner_id = current_user.id
    return preview_order(db, owner_id, payload)


@router.post("/{order_id}/cancel")
@limiter.limit("60/minute")
def cancel(request: Request, response: Response, order_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_trader)):
    try:
        order = cancel_order(db, current_user.id, order_id)
        db.commit()
        asset = db.get(Asset, order.asset_id)
        return _order_out(order, asset.symbol)
    except Exception:
        db.rollback()
        raise


def _utc_z(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


@router.get("/{order_id}")
def get_order_detail(
    order_id: int = Path(gt=0),
    limit: int = Query(default=50, ge=1, le=100),
    after_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owner_id = int(current_user.id)
    with consistent_read(db):
        read_at = snapshot_clock(db)
        found = db.execute(
            select(Order, Asset.symbol)
            .join(Asset, Order.asset_id == Asset.id)
            .where(Order.id == order_id, Order.user_id == owner_id)
        ).one_or_none()
        if found is None:
            raise HTTPException(status_code=404, detail="Order not found")
        order, symbol = found
        owned_fills = (Trade.order_id == order.id, Trade.user_id == owner_id)
        total_fill_count = db.execute(select(func.count(Trade.id)).where(*owned_fills)).scalar_one()
        page = select(Trade).where(*owned_fills)
        if after_id is not None:
            page = page.where(Trade.id > after_id)
        loaded = db.execute(page.order_by(Trade.id.asc()).limit(limit + 1)).scalars().all()
        has_more = len(loaded) > limit
        returned = loaded[:limit]
        fills = [
            {
                "trade_id": int(trade.id),
                "quantity": f"{Decimal(trade.quantity):.6f}",
                "execution_price": f"{Decimal(trade.price_at_execution):.6f}",
                "notional": f"{notional_amount(Decimal(trade.quantity), Decimal(trade.price_at_execution)):.2f}",
                "realized_pnl": f"{Decimal(trade.realized_pnl):.2f}",
                "executed_at": _utc_z(trade.executed_at),
            }
            for trade in returned
        ]
        body = {
            "order_id": int(order.id),
            "symbol": symbol,
            "side": order.side,
            "order_type": order.order_type,
            "status": order.status,
            "quantity": f"{Decimal(order.quantity):.6f}",
            "filled_quantity": f"{Decimal(order.quantity) - Decimal(order.remaining_quantity):.6f}",
            "remaining_quantity": f"{Decimal(order.remaining_quantity):.6f}",
            "limit_price": None if order.limit_price is None else f"{Decimal(order.limit_price):.6f}",
            "currency": "USD",
            "created_at": _utc_z(order.created_at),
            "canceled_at": _utc_z(order.canceled_at),
            "read_at": _utc_z(read_at),
            "total_fill_count": int(total_fill_count),
            "limit": limit,
            "has_more": has_more,
            "next_after_id": int(returned[-1].id) if has_more else None,
            "fills": fills,
        }
        return body
