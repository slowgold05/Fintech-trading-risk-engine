from sqlalchemy import Column, Integer, DateTime, ForeignKey, func
from app.core.database import Base


class RiskAssessment(Base):
    __tablename__ = "risk_assessments"

    id = Column(Integer, primary_key=True)
    trade_id = Column(Integer, ForeignKey("trades.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    risk_score = Column(Integer, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
