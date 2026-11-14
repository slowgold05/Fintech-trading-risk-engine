from sqlalchemy import CheckConstraint, Column, ForeignKey, Integer, String, UniqueConstraint

from app.core.database import Base


class Watchlist(Base):
    __tablename__ = "watchlists"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_watchlists_user_name"),
        CheckConstraint("length(name) >= 1 AND length(name) <= 40", name="ck_watchlists_name_length"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(40), nullable=False)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (
        CheckConstraint("position >= 1", name="ck_watchlist_items_position_positive"),
    )

    watchlist_id = Column(Integer, ForeignKey("watchlists.id", ondelete="CASCADE"), primary_key=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), primary_key=True)
    position = Column(Integer, nullable=False)
