from sqlalchemy import Column, Integer, String, Boolean
from app.core.database import Base


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(20), unique=True, nullable=False, index=True)
    asset_type = Column(String(20), nullable=False)  # "stock" or "crypto"
    name = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
