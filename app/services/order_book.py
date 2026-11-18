from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import case, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.selectable import Select

from app.core.security import require_active_user
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.order_step_up import order_notional, require_notional_step_up
from app.services.trade_execution import execute_fill, notional_amount, reserved_cash, reserved_shares
from app.services.pretrade_controls import (
    _price_band_problem, order_reference_quote, require_price_in_band, require_stock_concentration, require_trading_open,
)
from app.services.simulated_liquidity import SimulatedFill, plan_simulated_fill, provision_counterparty


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


def _lock_user(db: Session, user_id: int) -> User:
    return db.execute(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()


def _check_buying_power(db: Session, user: User, reservation: Decimal = Decimal(0)) -> None:
    if reserved_cash(db, user.id) + reservation > user.cash_balance:
        raise HTTPException(status_code=400, detail="Insufficient buying power")


def _check_shares(db: Session, user: User, asset: Asset, quantity: Decimal = Decimal(0)) -> None:
    holding = db.execute(
        select(Holding).where(Holding.user_id == user.id, Holding.asset_id == asset.id)
    ).scalar_one_or_none()
    if holding is None or quantity + reserved_shares(db, user.id, asset.id) > holding.quantity:
        raise HTTPException(status_code=400, detail="Not enough holdings to sell")


def _execute_match(
    db: Session, asset: Asset, order: Order, owner: User, counterparty: User, quantity: Decimal,
    price: Decimal, *, maker: Order | None = None, simulated_quote_at: datetime | None = None,
) -> tuple[int, int]:
    counter_order_id = maker.id if maker is not None else order.id
    sides = ((owner, order.id), (counterparty, counter_order_id))
    (buyer, buy_id), (seller, sell_id) = sides if order.side == "buy" else reversed(sides)
    filled_at = datetime.now(timezone.utc).replace(tzinfo=None)
    buy_trade, _ = execute_fill(db, buyer, asset, "buy", quantity, price, buy_id, filled_at,
                               simulated_quote_at=simulated_quote_at)
    sell_trade, _ = execute_fill(db, seller, asset, "sell", quantity, price, sell_id, filled_at,
                                simulated_quote_at=simulated_quote_at)
    order.remaining_quantity -= quantity
    if maker is not None:
        maker.remaining_quantity -= quantity
        if maker.remaining_quantity == 0:
            maker.status = "filled"
            maker.remainder_reason = None
    if reserved_cash(db, buyer.id) > buyer.cash_balance:
        raise HTTPException(status_code=400, detail="Insufficient buying power after matching")
    return buy_trade.id, sell_trade.id


def _execute_simulated_match(
    db: Session, asset: Asset, order: Order, user: User, fill: SimulatedFill
) -> tuple[int, int]:
    provider = provision_counterparty(db, asset, order.side, fill)
    trade_ids = _execute_match(db, asset, order, user, provider, fill.quantity, fill.price,
                               simulated_quote_at=fill.quote_at)
    order.simulated_quote_at = fill.quote_at
    return trade_ids


def place_order(
    db: Session, user_id: int, payload: OrderCreate, *, step_up_code: str | None = None,
) -> tuple[Order, list[int]]:
    require_trading_open(db)
    symbol = db.execute(select(MarketSymbol).where(MarketSymbol.symbol == payload.symbol, MarketSymbol.is_active.is_(True)).with_for_update()).scalar_one_or_none()
    if symbol is None:
        raise HTTPException(status_code=400, detail="Unknown or inactive stock symbol")
    quote = order_reference_quote(db, payload.symbol)
    if payload.expected_quote_observed_at is not None:
        if quote is None:
            raise HTTPException(status_code=400, detail="No current quote available to confirm against")
        # quote_at is stored naive. A client Z suffix arrives timezone-aware; drop tz before comparing.
        expected_quote_at = payload.expected_quote_observed_at.replace(tzinfo=None)
        if quote.quote_at != expected_quote_at:
            raise HTTPException(status_code=400, detail="Quote has changed since preview; request a new preview")
    require_price_in_band(quote, payload.limit_price)

    asset = db.execute(select(Asset).where(Asset.symbol == payload.symbol)).scalar_one_or_none()
    if asset is not None and asset.asset_type != "stock":
        raise HTTPException(status_code=400, detail="Symbol is registered as another asset type")
    if asset is None:
        asset = Asset(symbol=payload.symbol, asset_type="stock", name=symbol.company_name, is_active=True)
        db.add(asset)
        db.flush()

    makers = db.execute(resting_makers_select(asset.id, user_id, payload).with_for_update()).scalars().all()
    slices = allocate_slices(payload.quantity, makers)
    remaining = payload.quantity - sum((qty for _, qty in slices), Decimal(0))
    simulated, remainder_reason = plan_simulated_fill(payload.side, payload.limit_price, remaining, quote)

    users = {account_id: _lock_user(db, account_id)
             for account_id in sorted({user_id, *(maker.user_id for maker in makers)})}
    user = users[user_id]
    require_active_user(user)
    require_notional_step_up(db, user, order_notional(payload, quote), step_up_code)

    if payload.side == "buy":
        if payload.order_type == "limit":
            reservation = notional_amount(payload.quantity, payload.limit_price)
        else:
            reservation = sum((notional_amount(qty, maker.limit_price) for maker, qty in slices), Decimal(0))
            if simulated is not None:
                reservation += notional_amount(simulated.quantity, simulated.price)
        _check_buying_power(db, user, reservation)
        reference_price = quote.price
        risk_price = payload.limit_price if payload.limit_price is not None else reference_price * Decimal("1.20")
        require_stock_concentration(db, user, asset, payload.quantity, reference_price, risk_price)
    else:
        _check_shares(db, user, asset, payload.quantity)

    order = Order(user_id=user_id, asset_id=asset.id, side=payload.side, order_type=payload.order_type,
                  quantity=payload.quantity, remaining_quantity=payload.quantity, limit_price=payload.limit_price,
                  status="open" if payload.order_type == "limit" else "canceled")
    db.add(order)
    db.flush()
    trade_ids = []
    for maker, qty in slices:
        require_price_in_band(quote, maker.limit_price)
        # Resting order sets the execution price for both sides.
        trade_ids.extend(_execute_match(db, asset, order, user, users[maker.user_id], qty, maker.limit_price,
                                        maker=maker))
    if simulated is not None:
        trade_ids.extend(_execute_simulated_match(db, asset, order, user, simulated))
    if order.remaining_quantity == 0:
        order.status = "filled"
    elif order.order_type == "market":
        order.status = "canceled"
        order.canceled_at = datetime.now(timezone.utc).replace(tzinfo=None)
        if remainder_reason is not None:
            remainder_reason += " The unfilled shares were canceled."
    order.remainder_reason = remainder_reason
    db.flush()
    return order, trade_ids


def sweep_resting_orders(db: Session, quote: MarketQuoteCache, halt_reason: str | None) -> None:
    """Try one simulated tranche per resting order on a newer quote under the symbol lock."""
    asset = db.execute(select(Asset).where(Asset.symbol == quote.symbol, Asset.asset_type == "stock")).scalar_one_or_none()
    if asset is None:
        return
    # Within each side use the same price-time ordering as the visible book.
    orders = db.execute(select(Order).where(
        Order.asset_id == asset.id, Order.status == "open",
        (Order.simulated_quote_at.is_(None) | (Order.simulated_quote_at < quote.quote_at)),
    ).order_by(Order.side, case((Order.side == "buy", -Order.limit_price), else_=Order.limit_price),
               Order.id).with_for_update()).scalars().all()
    for order in orders:
        reason = halt_reason or _price_band_problem(quote, order.limit_price)
        if reason is not None:
            order.remainder_reason = reason
            continue
        fill, reason = plan_simulated_fill(order.side, order.limit_price, order.remaining_quantity, quote)
        if fill is not None:
            try:
                with db.begin_nested():
                    user = _lock_user(db, order.user_id)
                    if order.side == "buy":
                        _check_buying_power(db, user)
                        # The open order already contributes its full remainder to pending exposure.
                        require_stock_concentration(db, user, asset, Decimal(0), quote.price, order.limit_price)
                    else:
                        _check_shares(db, user, asset)
                    _execute_simulated_match(db, asset, order, user, fill)
                    if order.remaining_quantity == 0:
                        order.status = "filled"
            except HTTPException as exc:
                if exc.status_code != 400:
                    raise
                reason = str(exc.detail)
        order.remainder_reason = reason


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
    order.remainder_reason = None
    if order.canceled_at is None:
        order.canceled_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.flush()
    return order
