from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user, get_current_trader
from app.models.user import User
from app.models.holding import Holding
from app.models.lot import Lot
from app.models.order import Order
from app.schemas.trade_impact import TradeImpactRequest
from app.services.ledger_service import append_reset, ensure_opening
from app.services.performance_service import build_performance_response
from app.services.portfolio_allocation import build_allocation_response
from app.services.portfolio_attribution import build_attribution_response
from app.services.portfolio_risk import build_risk_metrics_response
from app.services.portfolio_valuation import build_portfolio_response
from app.services.trade_impact import build_trade_impact_response

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/")
def get_portfolio(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Copy identity before the valuation read rolls the session back to a snapshot.
    user_id = current_user.id
    email = current_user.email
    return build_portfolio_response(db, user_id, email)


@router.get("/performance")
def get_portfolio_performance(
    range_token: str = Query(..., alias="range"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Copy identity before the performance read rolls the session back to a snapshot.
    user_id = current_user.id
    email = current_user.email
    return build_performance_response(db, user_id, email, range_token)


@router.get("/allocation")
def get_portfolio_allocation(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Copy identity before the valuation read rolls the session back to a snapshot.
    user_id = current_user.id
    email = current_user.email
    return build_allocation_response(db, user_id, email)


@router.get("/attribution")
def get_portfolio_attribution(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Copy identity before the valuation read rolls the session back to a snapshot.
    user_id = current_user.id
    email = current_user.email
    return build_attribution_response(db, user_id, email)


@router.get("/risk-metrics")
def get_portfolio_risk_metrics(
    range_token: str = Query(..., alias="range"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Copy identity before the performance read rolls the session back to a snapshot.
    user_id = current_user.id
    email = current_user.email
    return build_risk_metrics_response(db, user_id, email, range_token)


@router.post("/trade-impact")
def post_trade_impact(
    payload: TradeImpactRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Copy identity before the valuation read rolls the session back to a snapshot.
    user_id = current_user.id
    email = current_user.email
    return build_trade_impact_response(db, user_id, email, payload)


@router.post("/reset")
def reset_portfolio(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_trader),
):
    user_id = current_user.id

    current_user = db.execute(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()
    if db.execute(select(Order.id).where(Order.user_id == user_id, Order.status == "open").limit(1)).first():
        raise HTTPException(status_code=400, detail="Cancel open orders before resetting the portfolio")
    ensure_opening(db, current_user)
    append_reset(db, current_user, Decimal("100000.00"))

    db.query(Lot).filter(Lot.user_id == user_id).delete(synchronize_session=False)
    db.query(Holding).filter(Holding.user_id == user_id).delete(synchronize_session=False)

    current_user.cash_balance = 100000
    db.commit()

    return {
        "cash_balance": 100000.0,
        "buying_power": 100000.0,
        "total_account_value": 100000.0,
    }
