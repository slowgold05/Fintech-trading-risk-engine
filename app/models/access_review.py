from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, func

from app.core.database import Base


class AccessReview(Base):
    __tablename__ = "access_reviews"
    __table_args__ = (
        Index("ix_access_reviews_period_user", "period", "user_id"),
        CheckConstraint("decision IN ('retain', 'remove')", name="ck_access_reviews_decision"),
        CheckConstraint("reviewer_user_id <> user_id", name="ck_access_reviews_no_self_review"),
    )

    id = Column(Integer, primary_key=True)
    period = Column(String(7), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    observed_role = Column(String(24), nullable=False)
    observed_change_id = Column(Integer, ForeignKey("role_changes.id"), nullable=True)
    reviewer_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    decision = Column(String(10), nullable=False)
    reason = Column(String(255), nullable=False)
    reviewed_at = Column(DateTime, nullable=False, server_default=func.now())
