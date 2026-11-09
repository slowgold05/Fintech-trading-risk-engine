from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, func

from app.core.database import Base


class ResearchJob(Base):
    __tablename__ = "research_jobs"
    __table_args__ = (
        CheckConstraint(
            "status in ('queued','running','completed','failed','cancelled')",
            name="ck_research_jobs_status",
        ),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False)
    status = Column(String(16), nullable=False, default="queued")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())
    error_message = Column(String(500), nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
