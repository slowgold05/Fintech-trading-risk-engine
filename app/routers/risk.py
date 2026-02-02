from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.models.risk_assessment import RiskAssessment
from app.models.risk_alert import RiskAlert
from app.models.trade import Trade
from app.models.asset import Asset
from app.core.security import get_current_user
from app.models.user import User


router = APIRouter(dependencies=[Depends(get_current_user)])

@router.get("/")
def list_risk(db: Session = Depends(get_db)):
    """
    Returns risk assessments + alerts, newest first.
    (User is hardcoded to user_id=1 for now.)
    """
    user_id = current_user.id

    # Get assessments (newest first)
    assessments = db.execute(
        select(RiskAssessment)
        .where(RiskAssessment.user_id == user_id)
        .order_by(RiskAssessment.created_at.desc())
        .limit(50)
    ).scalars().all()

    if not assessments:
        return {"assessments": []}

    assessment_ids = [a.id for a in assessments]
    trade_ids = [a.trade_id for a in assessments]

    # Fetch related alerts for those assessments
    alerts = db.execute(
        select(RiskAlert)
        .where(RiskAlert.assessment_id.in_(assessment_ids))
        .order_by(RiskAlert.created_at.desc())
    ).scalars().all()

    alerts_by_assessment = {}
    for al in alerts:
        alerts_by_assessment.setdefault(al.assessment_id, []).append({
            "rule_code": al.rule_code,
            "severity": al.severity,
            "reason": al.reason,
            "created_at": al.created_at
        })

    # Fetch trade + asset symbol info
    trade_rows = db.execute(
        select(Trade, Asset)
        .join(Asset, Trade.asset_id == Asset.id)
        .where(Trade.id.in_(trade_ids))
    ).all()

    trade_map = {}
    for t, a in trade_rows:
        trade_map[t.id] = {
            "symbol": a.symbol,
            "asset_type": a.asset_type,
            "side": t.side,
            "quantity": float(t.quantity),
            "price_at_execution": float(t.price_at_execution),
            "executed_at": t.executed_at,
        }

    # Build response
    out = []
    for a in assessments:
        out.append({
            "assessment_id": a.id,
            "trade_id": a.trade_id,
            "risk_score": a.risk_score,
            "created_at": a.created_at,
            "trade": trade_map.get(a.trade_id),
            "alerts": alerts_by_assessment.get(a.id, [])
        })

    return {"assessments": out}


@router.get("/trade/{trade_id}")
def risk_for_trade(trade_id: int, db: Session = Depends(get_db)):
    """
    Returns the risk assessment + alerts for a specific trade.
    """
    user_id = 1  # TODO: replace with JWT user later

    assessment = db.execute(
        select(RiskAssessment)
        .where(RiskAssessment.trade_id == trade_id, RiskAssessment.user_id == user_id)
    ).scalar_one_or_none()

    if assessment is None:
        return {"message": "No risk assessment found for this trade."}

    alerts = db.execute(
        select(RiskAlert)
        .where(RiskAlert.assessment_id == assessment.id)
        .order_by(RiskAlert.created_at.desc())
    ).scalars().all()

    return {
        "assessment_id": assessment.id,
        "trade_id": assessment.trade_id,
        "risk_score": assessment.risk_score,
        "created_at": assessment.created_at,
        "alerts": [
            {
                "rule_code": a.rule_code,
                "severity": a.severity,
                "reason": a.reason,
                "created_at": a.created_at
            }
            for a in alerts
        ]
    }
