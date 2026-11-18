from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.core.database import Base


class NightInboxRead(Base):
    __tablename__ = "night_inbox_reads"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    event_key = Column(String(64), primary_key=True)
    read_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
