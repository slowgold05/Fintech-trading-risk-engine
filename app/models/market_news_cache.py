from sqlalchemy import Column, DateTime, JSON, String, func

from app.core.database import Base


class MarketNewsCache(Base):
    __tablename__ = "market_news_cache"

    symbol = Column(String(20), primary_key=True)
    payload = Column(JSON, nullable=False)
    source = Column(String(32), nullable=False, default="finnhub")
    fetched_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)
