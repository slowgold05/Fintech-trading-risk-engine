from sqlalchemy import Column, Integer, ForeignKey, Numeric, UniqueConstraint
from app.core.database import Base


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("user_id", "asset_id", name="uq_user_asset"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False, index=True)

    quantity = Column(Numeric(18, 6), nullable=False, default=0)
    avg_cost = Column(Numeric(18, 6), nullable=False, default=0)
