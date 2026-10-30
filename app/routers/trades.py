from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.security import get_current_user, get_current_trader
from app.models.asset import Asset
from app.models.user import User
from app.models.trade import Trade
from app.schemas.trade import TradeCreate, TradeOut
from app.services.price_service import get_live_price
from app.services.trade_execution import CENT, SIX_PLACES, execute_fill, notional_amount, reserved_cash, reserved_shares
from app.models.holding import Holding
from app.services.pretrade_controls import require_stock_concentration, require_trading_open
from app.services.idempotency import execute_once

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/")
def list_trades(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.execute(
        select(Trade, Asset)
        .join(Asset, Trade.asset_id == Asset.id)
        .where(Trade.user_id == current_user.id)
        .order_by(Trade.executed_at.desc(), Trade.id.desc())
        .limit(limit)
    ).all()

    return {
        "trades": [
            {
                "id": trade.id,
                "symbol": asset.symbol,
                "asset_type": asset.asset_type,
                "side": trade.side,
                "quantity": float(trade.quantity),
                "price_at_execution": float(trade.price_at_execution),
                "notional": float((trade.quantity * trade.price_at_execution).quantize(CENT, rounding=ROUND_HALF_UP)),
                "realized_pnl": round(float(trade.realized_pnl or 0.0), 2),
                "realized_pnl_pct": round(float(trade.realized_pnl_pct or 0.0), 2),
                "executed_at": trade.executed_at,
            }
            for trade, asset in rows
        ]
    }


@router.post("/", response_model=TradeOut)
@limiter.limit("60/minute")
def create_trade(
    request: Request,
    payload: TradeCreate,
    idempotency_key: str = Header(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_trader),
):
    return execute_once(db, current_user.id, idempotency_key, "trade", payload,
                        lambda: _execute_trade(db, current_user, payload))


def _execute_trade(db: Session, current_user: User, payload: TradeCreate) -> dict:
    require_trading_open()
    user_id = current_user.id

    symbol = payload.symbol

    # Serialize this account's orders, including buys and sells of new holdings.
    current_user = db.execute(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()

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
    try:
        price = Decimal(str(get_live_price(symbol, payload.asset_type)))
        if not price.is_finite() or price <= 0:
            raise ValueError("Invalid price quote.")
        price = price.quantize(SIX_PLACES, rounding=ROUND_HALF_UP)
        if price == 0:
            raise ValueError("Invalid price quote.")
    except (ValueError, InvalidOperation) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if payload.side == "buy" and notional_amount(payload.quantity, price) > current_user.cash_balance - reserved_cash(db, user_id):
        raise HTTPException(status_code=400, detail="Insufficient buying power")
    if payload.side == "buy" and payload.asset_type == "stock":
        require_stock_concentration(db, current_user, asset, payload.quantity, price, price)
    if payload.side == "sell":
        holding = db.execute(select(Holding).where(Holding.user_id == user_id, Holding.asset_id == asset.id)).scalar_one_or_none()
        if holding is None or payload.quantity > holding.quantity - reserved_shares(db, user_id, asset.id):
            raise HTTPException(status_code=400, detail="Not enough holdings to sell")
    trade, score = execute_fill(db, current_user, asset, payload.side, payload.quantity, price)
    return {"trade_id": trade.id, "risk_score": score}
