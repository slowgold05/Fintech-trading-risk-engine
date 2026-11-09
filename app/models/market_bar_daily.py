"""Canonical daily research bars; provider and adjustment series remain separate."""

from sqlalchemy import BigInteger, CheckConstraint, Column, Date, DateTime, ForeignKey, Numeric, String

from app.core.database import Base


class MarketBarDaily(Base):
    __tablename__ = "market_bars_daily"
    __table_args__ = (
        CheckConstraint("trim(provider) <> '' AND provider = trim(provider)", name="ck_market_bars_daily_provider"),
        CheckConstraint("adjustment_type IN ('raw', 'split_adjusted')", name="ck_market_bars_daily_adjustment"),
        CheckConstraint("quality_status IN ('valid', 'flagged', 'rejected')", name="ck_market_bars_daily_quality"),
        # The Numeric(18, 6) upper bound also rejects PostgreSQL numeric NaN.
        CheckConstraint(
            "open > 0 AND open < 1000000000000 AND high > 0 AND high < 1000000000000 "
            "AND low > 0 AND low < 1000000000000 AND close > 0 AND close < 1000000000000",
            name="ck_market_bars_daily_prices",
        ),
        CheckConstraint("low <= open AND open <= high AND low <= close AND close <= high", name="ck_market_bars_daily_ohlc"),
        CheckConstraint("volume >= 0", name="ck_market_bars_daily_volume"),
    )

    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="CASCADE"), primary_key=True)
    session_date = Column(Date, primary_key=True)
    provider = Column(String(32), primary_key=True)
    adjustment_type = Column(String(24), primary_key=True)
    open = Column(Numeric(18, 6), nullable=False)
    high = Column(Numeric(18, 6), nullable=False)
    low = Column(Numeric(18, 6), nullable=False)
    close = Column(Numeric(18, 6), nullable=False)
    volume = Column(BigInteger, nullable=False)
    fetched_at = Column(DateTime(timezone=True), nullable=False)
    quality_status = Column(String(16), nullable=False)
