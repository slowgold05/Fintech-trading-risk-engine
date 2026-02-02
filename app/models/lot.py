from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.core.database import Base


class Lot(Base):
    __tablename__ = "lots"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    asset_id = Column(Integer, ForeignKey("assets.id"), index=True, nullable=False)

    qty_remaining = Column(Float, nullable=False)
    cost_per_unit = Column(Float, nullable=False)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
