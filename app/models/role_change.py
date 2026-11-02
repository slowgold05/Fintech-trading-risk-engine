from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.core.database import Base


class RoleChange(Base):
    __tablename__ = "role_changes"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    old_role = Column(String(24), nullable=False)
    new_role = Column(String(24), nullable=False)
    actor = Column(String(128), nullable=False)
    reason = Column(String(255), nullable=False)
    request_id = Column(Integer, ForeignKey("role_change_requests.id"), nullable=True)
    changed_at = Column(DateTime, nullable=False, server_default=func.now())
