from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String

from app.core.database import Base


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    trade_id = Column(Integer, ForeignKey("trades.id"), nullable=True, index=True)
    event_id = Column(String(32), nullable=False, index=True)
    event_kind = Column(String(32), nullable=False)
    account = Column(String(32), nullable=False)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)
    unit = Column(String(32), nullable=False)
    amount = Column(Numeric(24, 6), nullable=False)
    created_at = Column(DateTime, nullable=False)
    previous_hash = Column(String(64), nullable=False)
    entry_hash = Column(String(64), nullable=False)
