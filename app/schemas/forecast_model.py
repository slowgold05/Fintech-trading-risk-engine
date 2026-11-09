from pydantic import BaseModel


class ForecastModelOut(BaseModel):
    id: str
    model_name: str
    tokenizer_name: str
    enabled: bool
    max_lookback: int
    max_horizon: int
    max_sample_count: int
    source_commit: str
    license: str


class ForecastModelCollection(BaseModel):
    models: list[ForecastModelOut]
