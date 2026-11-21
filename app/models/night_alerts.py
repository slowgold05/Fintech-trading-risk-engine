from sqlalchemy import CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, null, text

from app.core.database import Base


class NightAlert(Base):
    __tablename__ = "night_alerts"
    __table_args__ = (
        CheckConstraint("direction IN ('at_or_above', 'at_or_below')", name="ck_night_alerts_direction"),
        CheckConstraint("target > 0 AND target < 1000000000000", name="ck_night_alerts_target"),
        CheckConstraint(
            "(last_date IS NULL AND last_close IS NULL AND last_provider IS NULL AND last_observed_at IS NULL "
            "AND triggered_at IS NULL) OR (last_date IS NOT NULL AND last_close IS NOT NULL "
            "AND last_close > 0 AND last_close < 1000000000000 "
            "AND last_provider IS NOT NULL AND last_observed_at IS NOT NULL)",
            name="ck_night_alerts_observation",
        ),
        Index("ix_night_alerts_owner", "user_id", "id"),
        Index(
            "uq_night_alerts_active_rule", "user_id", "symbol", "direction", "target", unique=True,
            postgresql_where=text("triggered_at IS NULL"), sqlite_where=text("triggered_at IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol"), nullable=False)
    direction = Column(String(12), nullable=False)
    target = Column(Numeric(18, 6), nullable=False)
    last_date = Column(Date, server_default=null())
    last_close = Column(Numeric(18, 6), server_default=null())
    last_provider = Column(String(32), server_default=null())
    last_observed_at = Column(DateTime(timezone=True), server_default=null())
    triggered_at = Column(DateTime(timezone=True), server_default=null())
