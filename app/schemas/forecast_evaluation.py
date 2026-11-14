from pydantic import BaseModel


class ForecastEvaluationOut(BaseModel):
    id: int
    symbol: str
    provider: str
    adjustment_type: str
    horizon: int
    window_count: int
    model_mae: float
    model_directional_accuracy: float
    baseline_type: str
    baseline_mae: float
    baseline_directional_accuracy: float
    weights_exercised: bool
    notes: str | None
    created_at: str


class ForecastEvaluationCollection(BaseModel):
    evaluations: list[ForecastEvaluationOut]
