from sqlalchemy import Column, DateTime, Integer, String, Text

from app.core.database import Base


class ControlEvidence(Base):
    __tablename__ = "control_evidence"

    id = Column(Integer, primary_key=True)
    control_id = Column(String(32), nullable=False, index=True)
    run_at = Column(DateTime, nullable=False)
    payload = Column(Text, nullable=False)
    sha256 = Column(String(64), nullable=False)
