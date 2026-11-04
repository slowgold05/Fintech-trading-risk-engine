from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.trade_execution import reserved_cash


def check_buying_power(db: Session) -> dict:
    users = db.execute(select(User).order_by(User.id)).scalars().all()
    violations = []
    for user in users:
        reserved = reserved_cash(db, user.id)
        if reserved > Decimal(user.cash_balance):
            violations.append(user.id)
    return {"checked": len(users), "violation_count": len(violations), "violations": violations[:20]}
