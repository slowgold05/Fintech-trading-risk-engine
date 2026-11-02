from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Numeric, String, func

from app.core.database import Base


class MarketQuoteCache(Base):
    __tablename__ = "market_quote_cache"

    symbol = Column(
        String(20),
        ForeignKey("market_symbols.symbol", ondelete="CASCADE"),
        primary_key=True,
    )
    price = Column(Numeric(18, 6), nullable=False)
    change_amount = Column(Numeric(18, 6), nullable=False, default=0)
    change_percent = Column(Numeric(10, 4), nullable=False, default=0)
    volume = Column(BigInteger, nullable=False, default=0)
    source = Column(String(32), nullable=False)
    quote_at = Column(DateTime, nullable=True)
    fetched_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        index=True,
    )
