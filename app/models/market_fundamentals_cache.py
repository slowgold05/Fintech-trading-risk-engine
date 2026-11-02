from sqlalchemy import Column, DateTime, JSON, String, func

from app.core.database import Base


class MarketFundamentalsCache(Base):
    __tablename__ = "market_fundamentals_cache"

    symbol = Column(String(20), primary_key=True)
    cik = Column(String(10), nullable=False, index=True)
    payload = Column(JSON, nullable=False)
    source = Column(String(32), nullable=False, default="sec_edgar")
    fetched_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)
