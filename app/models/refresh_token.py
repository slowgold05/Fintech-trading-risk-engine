from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.core.database import Base


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    revoked_at = Column(DateTime, nullable=True, index=True)
    user_agent = Column(String(512), nullable=True)
    ip = Column(String(64), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
