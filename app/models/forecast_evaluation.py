from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, func

from app.core.database import Base


class ForecastEvaluation(Base):
    __tablename__ = "forecast_evaluations"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False, index=True)
    provider = Column(String(32), nullable=False)
    adjustment_type = Column(String(20), nullable=False)
    horizon = Column(Integer, nullable=False)
    window_count = Column(Integer, nullable=False)
    model_mae = Column(Float, nullable=False)
    model_directional_accuracy = Column(Float, nullable=False)
    baseline_type = Column(String(32), nullable=False)
    baseline_mae = Column(Float, nullable=False)
    baseline_directional_accuracy = Column(Float, nullable=False)
    weights_exercised = Column(Boolean, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
