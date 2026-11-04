from sqlalchemy import CheckConstraint, Column, DateTime, Integer, String

from app.core.database import Base


class DetectionCursor(Base):
    __tablename__ = "detection_cursors"
    __table_args__ = (
        CheckConstraint("name IN ('surveillance', 'aml')", name="ck_detection_cursors_name"),
    )

    name = Column(String(32), primary_key=True)
    scanned_through = Column(DateTime, nullable=True)
    pending_since = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False)


class SchedulerLock(Base):
    __tablename__ = "scheduler_locks"

    id = Column(Integer, primary_key=True)
    owner = Column(String(64), nullable=True)
    acquired_at = Column(DateTime, nullable=True)
    next_due = Column(DateTime, nullable=True)
