from sqlalchemy import Column, DateTime, Numeric, String, func

from app.core.database import Base


class MarketReferenceCache(Base):
    """Cached share count from the Massive ticker reference endpoint."""

    __tablename__ = "market_reference_cache"

    symbol = Column(String(20), primary_key=True)
    shares_outstanding = Column(Numeric(24, 4), nullable=True)
    source = Column(String(32), nullable=False)
    fetched_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)
