from sqlalchemy import Column, ForeignKey, Integer, JSON, String, UniqueConstraint

from app.core.database import Base


class OrderRequest(Base):
    __tablename__ = "order_requests"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key", name="uq_order_requests_user_key"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    idempotency_key = Column(String(128), nullable=False)
    request_hash = Column(String(64), nullable=False)
    response = Column(JSON, nullable=True)
