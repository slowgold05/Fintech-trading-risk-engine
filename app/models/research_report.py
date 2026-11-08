from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, func

from app.core.database import Base


class ResearchReport(Base):
    __tablename__ = "research_reports"

    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey("research_jobs.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    sources = Column(JSON, nullable=False)
    bull_case = Column(Text, nullable=True)
    bear_case = Column(Text, nullable=True)
    synthesis = Column(Text, nullable=True)
    risks = Column(Text, nullable=True)
    model_version = Column(String(64), nullable=True)
    prompt_version = Column(String(64), nullable=True)
