from sqlalchemy import Column, Integer, DateTime, ForeignKey, Numeric, func
from app.core.database import Base


class PriceHistory(Base):
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False, index=True)
    ts = Column(DateTime, server_default=func.now(), nullable=False, index=True)
    price = Column(Numeric(18, 6), nullable=False)
