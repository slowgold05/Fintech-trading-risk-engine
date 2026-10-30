from sqlalchemy import CheckConstraint, Column, Integer, Numeric, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.core.database import Base


class Lot(Base):
    __tablename__ = "lots"
    __table_args__ = (CheckConstraint("qty_remaining >= 0", name="ck_lots_qty_nonnegative"),)

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    asset_id = Column(Integer, ForeignKey("assets.id"), index=True, nullable=False)

    qty_remaining = Column(Numeric(18, 6), nullable=False)
    cost_per_unit = Column(Numeric(18, 6), nullable=False)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
