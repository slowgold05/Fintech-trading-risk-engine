from pydantic import BaseModel


class ForecastBar(BaseModel):
    session_date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class ForecastResultOut(BaseModel):
    id: int
    job_id: int
    symbol: str
    provider: str
    adjustment_type: str
    model_name: str
    tokenizer_name: str
    lookback: int
    horizon: int
    sample_count: int
    input_cutoff: str
    generated_at: str
    bars: list[ForecastBar]


class ForecastResultCollection(BaseModel):
    results: list[ForecastResultOut]
