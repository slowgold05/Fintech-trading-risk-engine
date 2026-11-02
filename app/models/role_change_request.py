from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, func, text

from app.core.database import Base


class RoleChangeRequest(Base):
    __tablename__ = "role_change_requests"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'approved', 'applied')", name="ck_role_change_requests_status"),
        CheckConstraint("approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id",
                        name="ck_role_change_requests_separate_approver"),
    )

    id = Column(Integer, primary_key=True)
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    old_role = Column(String(24), nullable=False)
    old_change_id = Column(Integer, ForeignKey("role_changes.id"), nullable=True)
    new_role = Column(String(24), nullable=False)
    reason = Column(String(255), nullable=False)
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(12), nullable=False, server_default=text("'pending'"))
    requested_at = Column(DateTime, nullable=False, server_default=func.now())
    approved_at = Column(DateTime, nullable=True)
    applied_at = Column(DateTime, nullable=True)
