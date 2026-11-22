from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Integer, String, func

from app.core.database import Base


class NightLeaderboardEntry(Base):
    __tablename__ = "night_leaderboard_entries"

    # A row represents an active opt-in. Its deletion also releases the alias.
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, autoincrement=False)
    alias = Column(String(24).with_variant(String(24, collation="C"), "postgresql"), nullable=False)

    __table_args__ = (
        CheckConstraint("length(alias) BETWEEN 3 AND 24 AND alias = trim(alias)", name="ck_night_leaderboard_alias"),
        Index("uq_night_leaderboard_alias", func.lower(alias), unique=True),
    )
