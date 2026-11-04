from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, func, null

from app.core.database import Base


class MfaFactor(Base):
    __tablename__ = "mfa_factors"
    __table_args__ = (
        CheckConstraint("method IN ('totp')", name="ck_mfa_factors_method"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    method = Column(String(12), nullable=False, default="totp")
    secret_ciphertext = Column(Text, nullable=False)
    confirmed_at = Column(DateTime, nullable=True, server_default=null())
    last_counter = Column(Integer, nullable=True, server_default=null())
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class LoginEvent(Base):
    __tablename__ = "login_events"
    __table_args__ = (
        CheckConstraint("outcome IN ('failure', 'step_up', 'success', 'denied')", name="ck_login_events_outcome"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    email = Column(String(255), nullable=False)
    ip = Column(String(64), nullable=True, index=True)
    user_agent_hash = Column(String(64), nullable=False)
    outcome = Column(String(12), nullable=False)
    risk_score = Column(Integer, nullable=False, default=0)
    step_up_satisfied = Column(Boolean, nullable=False, default=False)
    reasons = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)


class LoginChallenge(Base):
    __tablename__ = "login_challenges"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    consumed_at = Column(DateTime, nullable=True, server_default=null())
    risk_score = Column(Integer, nullable=False, default=0)
    reasons = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
