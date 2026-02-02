from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.models.trade import Trade


def assess_trade_risk(db: Session, user_id: int, trade_notional: float) -> tuple[int, list[dict]]:
    alerts = []
    score = 0

    # Rule 1: many trades in last 5 minutes
    five_min_ago = datetime.utcnow() - timedelta(minutes=5)
    count_stmt = select(func.count()).select_from(Trade).where(
        Trade.user_id == user_id,
        Trade.executed_at >= five_min_ago
    )
    recent_trades = db.execute(count_stmt).scalar_one()

    if recent_trades >= 5:
        score += 40
        alerts.append({"rule_code": "MANY_TRADES_5MIN", "severity": "high", "reason": "5+ trades in last 5 minutes"})

    # Rule 2: large notional (simple threshold for now)
    if trade_notional >= 10_000:
        score += 30
        alerts.append({"rule_code": "LARGE_TRADE", "severity": "med", "reason": "Trade notional >= 10,000 USD"})

    score = min(score, 100)
    return score, alerts
