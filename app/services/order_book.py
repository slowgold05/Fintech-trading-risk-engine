from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.trade_execution import execute_fill, notional_amount, reserved_cash, reserved_shares
from app.services.pretrade_controls import require_price_in_band, require_stock_concentration, require_trading_open
from app.models.market_quote_cache import MarketQuoteCache


def place_order(db: Session, user_id: int, payload: OrderCreate) -> tuple[Order, list[int]]:
    require_trading_open(db)
    symbol = db.execute(select(MarketSymbol).where(MarketSymbol.symbol == payload.symbol, MarketSymbol.is_active.is_(True)).with_for_update()).scalar_one_or_none()
    if symbol is None:
        raise HTTPException(status_code=400, detail="Unknown or inactive stock symbol")
    require_price_in_band(db, payload.symbol, payload.limit_price)

    asset = db.execute(select(Asset).where(Asset.symbol == payload.symbol)).scalar_one_or_none()
    if asset is not None and asset.asset_type != "stock":
        raise HTTPException(status_code=400, detail="Symbol is registered as another asset type")
    if asset is None:
        asset = Asset(symbol=payload.symbol, asset_type="stock", name=symbol.company_name, is_active=True)
        db.add(asset)
        db.flush()

    opposite = "sell" if payload.side == "buy" else "buy"
    crossing = (Order.limit_price <= payload.limit_price if payload.side == "buy" else Order.limit_price >= payload.limit_price) if payload.order_type == "limit" else True
    price_order = Order.limit_price.asc() if payload.side == "buy" else Order.limit_price.desc()
    makers = db.execute(
        select(Order).where(Order.asset_id == asset.id, Order.side == opposite, Order.status == "open", Order.user_id != user_id, crossing)
        .order_by(price_order, Order.id.asc()).with_for_update()
    ).scalars().all()

    users = {}
    for account_id in sorted({user_id, *(maker.user_id for maker in makers)}):
        users[account_id] = db.execute(
            select(User).where(User.id == account_id).with_for_update().execution_options(populate_existing=True)
        ).scalar_one()
    user = users[user_id]

    if payload.side == "buy":
        if payload.order_type == "limit":
            reservation = notional_amount(payload.quantity, payload.limit_price)
        else:
            left = payload.quantity
            reservation = Decimal(0)
            for maker in makers:
                take = min(left, maker.remaining_quantity)
                reservation += notional_amount(take, maker.limit_price)
                left -= take
                if left == 0:
                    break
        if reservation > user.cash_balance - reserved_cash(db, user_id):
            raise HTTPException(status_code=400, detail="Insufficient buying power")
        reference_price = db.get(MarketQuoteCache, payload.symbol).price
        risk_price = payload.limit_price if payload.limit_price is not None else reference_price * Decimal("1.20")
        require_stock_concentration(db, user, asset, payload.quantity, reference_price, risk_price)
    else:
        holding = db.execute(select(Holding).where(Holding.user_id == user_id, Holding.asset_id == asset.id)).scalar_one_or_none()
        if holding is None or payload.quantity > holding.quantity - reserved_shares(db, user_id, asset.id):
            raise HTTPException(status_code=400, detail="Not enough holdings to sell")

    order = Order(user_id=user_id, asset_id=asset.id, side=payload.side, order_type=payload.order_type,
                  quantity=payload.quantity, remaining_quantity=payload.quantity, limit_price=payload.limit_price,
                  status="open" if payload.order_type == "limit" else "canceled")
    db.add(order)
    db.flush()
    trade_ids = []
    for maker in makers:
        if order.remaining_quantity == 0:
            break
        qty = min(order.remaining_quantity, maker.remaining_quantity)
        require_price_in_band(db, payload.symbol, maker.limit_price)
        # Resting order sets the execution price for both sides.
        buy_order, sell_order = (order, maker) if order.side == "buy" else (maker, order)
        buy_trade, _ = execute_fill(db, users[buy_order.user_id], asset, "buy", qty, maker.limit_price, buy_order.id)
        sell_trade, _ = execute_fill(db, users[sell_order.user_id], asset, "sell", qty, maker.limit_price, sell_order.id)
        trade_ids.extend((buy_trade.id, sell_trade.id))
        order.remaining_quantity -= qty
        maker.remaining_quantity -= qty
        if maker.remaining_quantity == 0:
            maker.status = "filled"
        if reserved_cash(db, buy_order.user_id) > users[buy_order.user_id].cash_balance:
            raise HTTPException(status_code=400, detail="Insufficient buying power after matching")
    if order.remaining_quantity == 0:
        order.status = "filled"
    elif order.order_type == "market":
        order.status = "canceled"
    db.flush()
    return order, trade_ids


def cancel_order(db: Session, user_id: int, order_id: int) -> Order:
    row = db.execute(select(Order, Asset).join(Asset, Order.asset_id == Asset.id).where(Order.id == order_id, Order.user_id == user_id)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Order not found")
    db.execute(select(MarketSymbol).where(MarketSymbol.symbol == row.Asset.symbol).with_for_update()).scalar_one()
    db.execute(select(User).where(User.id == user_id).with_for_update()).scalar_one()
    order = db.execute(select(Order).where(Order.id == order_id).with_for_update().execution_options(populate_existing=True)).scalar_one()
    if order.status != "open":
        raise HTTPException(status_code=409, detail="Order is no longer open")
    order.status = "canceled"
    db.flush()
    return order
