from sqlalchemy import CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func, null

from app.core.database import Base


class TradeIntent(Base):
    __tablename__ = "trade_intents"
    __table_args__ = (
        CheckConstraint("side IN ('buy', 'sell')", name="ck_trade_intents_side"),
        CheckConstraint("status IN ('proposed', 'rejected', 'approved')", name="ck_trade_intents_status"),
    )

    id = Column(Integer, primary_key=True)
    symbol = Column(String(20), nullable=False)
    side = Column(String(4), nullable=False)
    quantity = Column(Numeric(18, 6), nullable=False)
    reference_price = Column(Numeric(18, 6), nullable=False)
    rationale = Column(Text, nullable=False)
    confidence = Column(Numeric(4, 3), nullable=False)
    data_used = Column(Text, nullable=False)
    status = Column(String(12), nullable=False)
    rejection_reason = Column(String(255), nullable=True)
    proposed_by = Column(String(64), nullable=False)
    decided_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, server_default=null())
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    decided_at = Column(DateTime, nullable=True, server_default=null())


class Finding(Base):
    __tablename__ = "findings"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'remediated')", name="ck_findings_status"),
        CheckConstraint("severity IN ('low', 'moderate', 'high')", name="ck_findings_severity"),
    )

    id = Column(Integer, primary_key=True)
    control_id = Column(String(32), nullable=False, index=True)
    severity = Column(String(12), nullable=False)
    owner = Column(String(64), nullable=False)
    summary = Column(String(255), nullable=False)
    status = Column(String(12), nullable=False)
    due_at = Column(DateTime, nullable=False)
    opened_at = Column(DateTime, nullable=False, server_default=func.now())


class RiskBrief(Base):
    __tablename__ = "risk_briefs"

    id = Column(Integer, primary_key=True)
    brief_date = Column(Date, nullable=False)
    body = Column(Text, nullable=False)
    figures = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class ExpansionAlert(Base):
    __tablename__ = "expansion_alerts"

    id = Column(Integer, primary_key=True)
    kind = Column(String(32), nullable=False)
    summary = Column(String(255), nullable=False)
    evidence_ref = Column(String(64), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
