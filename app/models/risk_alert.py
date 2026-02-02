from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from app.core.database import Base


class RiskAlert(Base):
    __tablename__ = "risk_alerts"

    id = Column(Integer, primary_key=True)
    assessment_id = Column(Integer, ForeignKey("risk_assessments.id"), nullable=False, index=True)
    rule_code = Column(String(100), nullable=False)
    severity = Column(String(10), nullable=False)  # low/med/high
    reason = Column(String(500), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
