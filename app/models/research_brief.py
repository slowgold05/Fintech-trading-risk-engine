from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, JSON, UniqueConstraint, func

from app.core.database import Base


class ResearchBrief(Base):
    __tablename__ = "research_briefs"
    __table_args__ = (
        UniqueConstraint("user_id", "brief_date", name="uq_research_briefs_user_date"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    brief_date = Column(Date, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    entries = Column(JSON, nullable=False)
