from sqlalchemy import BigInteger, Column, Date, ForeignKey, Numeric, String, UniqueConstraint

from app.core.database import Base


class PriceHistoryDaily(Base):
    __tablename__ = "price_history_daily"
    __table_args__ = (
        UniqueConstraint("symbol", "date", name="uq_price_history_daily_symbol_date"),
    )

    symbol = Column(
        String(20),
        ForeignKey("market_symbols.symbol", ondelete="CASCADE"),
        primary_key=True,
    )
    date = Column(Date, primary_key=True)
    open = Column(Numeric(18, 6), nullable=False)
    high = Column(Numeric(18, 6), nullable=False)
    low = Column(Numeric(18, 6), nullable=False)
    close = Column(Numeric(18, 6), nullable=False)
    volume = Column(BigInteger, nullable=False, default=0)
    source = Column(String(32), nullable=False, default="stooq")
