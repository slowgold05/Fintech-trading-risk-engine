from sqlalchemy import Boolean, Column, DateTime, String, func

from app.core.database import Base


class MarketSymbol(Base):
    __tablename__ = "market_symbols"

    symbol = Column(String(20), primary_key=True)
    company_name = Column(String(255), nullable=False)
    exchange = Column(String(40), nullable=False)
    sector = Column(String(80), nullable=True, index=True)
    cik = Column(String(10), nullable=True, index=True)
    is_etf = Column(Boolean, nullable=False, default=False)
    is_test = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    refresh_tier = Column(String(16), nullable=False, default="daily", index=True)
    heatmap_size = Column(String(16), nullable=False, default="micro")
    source = Column(String(32), nullable=False, default="nasdaq_trader")
    synced_at = Column(DateTime, nullable=False, server_default=func.now())
