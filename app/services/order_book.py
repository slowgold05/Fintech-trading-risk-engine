from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.sql.selectable import Select

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.trade_execution import execute_fill, notional_amount, reserved_cash, reserved_shares
from app.services.pretrade_controls import require_price_in_band, require_stock_concentration, require_trading_open
from app.models.market_quote_cache import MarketQuoteCache


def resting_makers_select(asset_id: int, user_id: int, payload: OrderCreate) -> Select[tuple[Order]]:
    opposite = "sell" if payload.side == "buy" else "buy"
    crossing = (Order.limit_price <= payload.limit_price if payload.side == "buy" else Order.limit_price >= payload.limit_price) if payload.order_type == "limit" else True
    price_order = Order.limit_price.asc() if payload.side == "buy" else Order.limit_price.desc()
    return select(Order).where(
        Order.asset_id == asset_id, Order.side == opposite, Order.status == "open", Order.user_id != user_id, crossing
    ).order_by(price_order, Order.id.asc())


def allocate_slices(quantity: Decimal, makers: list[Order]) -> list[tuple[Order, Decimal]]:
    left = quantity
    slices: list[tuple[Order, Decimal]] = []
    for maker in makers:
        if left == 0:
            break
        take = min(left, maker.remaining_quantity)
        slices.append((maker, take))
        left -= take
    return slices


def place_order(db: Session, user_id: int, payload: OrderCreate) -> tuple[Order, list[int]]:
    require_trading_open(db)
    symbol = db.execute(select(MarketSymbol).where(MarketSymbol.symbol == payload.symbol, MarketSymbol.is_active.is_(True)).with_for_update()).scalar_one_or_none()
    if symbol is None:
        raise HTTPException(status_code=400, detail="Unknown or inactive stock symbol")
    if payload.expected_quote_observed_at is not None:
        quote = db.get(MarketQuoteCache, payload.symbol)
        if quote is None:
            raise HTTPException(status_code=400, detail="No current quote available to confirm against")
        # quote_at is stored naive. A client Z suffix arrives timezone-aware; drop tz before comparing.
        expected_quote_at = payload.expected_quote_observed_at.replace(tzinfo=None)
        if quote.quote_at != expected_quote_at:
            raise HTTPException(status_code=400, detail="Quote has changed since preview; request a new preview")
    require_price_in_band(db, payload.symbol, payload.limit_price)

    asset = db.execute(select(Asset).where(Asset.symbol == payload.symbol)).scalar_one_or_none()
    if asset is not None and asset.asset_type != "stock":
        raise HTTPException(status_code=400, detail="Symbol is registered as another asset type")
    if asset is None:
        asset = Asset(symbol=payload.symbol, asset_type="stock", name=symbol.company_name, is_active=True)
        db.add(asset)
        db.flush()

    makers = db.execute(resting_makers_select(asset.id, user_id, payload).with_for_update()).scalars().all()
    slices = allocate_slices(payload.quantity, makers)

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
            reservation = sum((notional_amount(qty, maker.limit_price) for maker, qty in slices), Decimal(0))
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
    for maker, qty in slices:
        require_price_in_band(db, payload.symbol, maker.limit_price)
        # Resting order sets the execution price for both sides.
        buy_order, sell_order = (order, maker) if order.side == "buy" else (maker, order)
        filled_at = datetime.now(timezone.utc).replace(tzinfo=None)
        buy_trade, _ = execute_fill(db, users[buy_order.user_id], asset, "buy", qty, maker.limit_price, buy_order.id, filled_at)
        sell_trade, _ = execute_fill(db, users[sell_order.user_id], asset, "sell", qty, maker.limit_price, sell_order.id, filled_at)
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
        order.canceled_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
    if order.canceled_at is None:
        order.canceled_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.flush()
    return order
