from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, Numeric, String, func

from app.core.database import Base


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_orders_quantity_positive"),
        CheckConstraint("remaining_quantity >= 0 AND remaining_quantity <= quantity", name="ck_orders_remaining_valid"),
        CheckConstraint("(order_type = 'limit' AND limit_price > 0) OR (order_type = 'market' AND limit_price IS NULL)", name="ck_orders_price_for_type"),
        CheckConstraint("side IN ('buy', 'sell')", name="ck_orders_side_valid"),
        CheckConstraint("status IN ('open', 'filled', 'canceled')", name="ck_orders_status_valid"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False, index=True)
    side = Column(String(10), nullable=False)
    order_type = Column(String(10), nullable=False, default="limit")
    quantity = Column(Numeric(18, 6), nullable=False)
    remaining_quantity = Column(Numeric(18, 6), nullable=False)
    limit_price = Column(Numeric(18, 6), nullable=True)
    status = Column(String(10), nullable=False, default="open")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
