from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, func

from app.core.database import Base


class TradingHaltState(Base):
    __tablename__ = "trading_halt_state"
    __table_args__ = (CheckConstraint("id = 1", name="ck_trading_halt_singleton"),)

    id = Column(Integer, primary_key=True)
    halted = Column(Boolean, nullable=False)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reason = Column(String(255), nullable=False)
    changed_at = Column(DateTime, nullable=False, server_default=func.now())


class TradingHaltEvent(Base):
    __tablename__ = "trading_halt_events"

    id = Column(Integer, primary_key=True)
    previous_halted = Column(Boolean, nullable=False)
    halted = Column(Boolean, nullable=False)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reason = Column(String(255), nullable=False)
    changed_at = Column(DateTime, nullable=False, server_default=func.now())
