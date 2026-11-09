from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, func

from app.core.database import Base


class ForecastResult(Base):
    __tablename__ = "forecast_results"

    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey("forecast_jobs.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False)
    provider = Column(String(32), nullable=False)
    adjustment_type = Column(String(20), nullable=False)
    model_name = Column(String(128), nullable=False)
    tokenizer_name = Column(String(128), nullable=False)
    lookback = Column(Integer, nullable=False)
    horizon = Column(Integer, nullable=False)
    sample_count = Column(Integer, nullable=False)
    input_cutoff = Column(String(10), nullable=False)
    generated_at = Column(DateTime, nullable=False)
    bars = Column(JSON, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
