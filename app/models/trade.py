from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric


from sqlalchemy.sql import func
from app.core.database import Base


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)

    side = Column(String(10), nullable=False)  # "buy" / "sell"
    quantity = Column(Numeric(18, 6), nullable=False)
    price_at_execution = Column(Numeric(18, 6), nullable=False)

    realized_pnl = Column(Numeric(18, 2), nullable=False, default=0)
    realized_pnl_pct = Column(Numeric(12, 4), nullable=False, default=0)


    executed_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)
