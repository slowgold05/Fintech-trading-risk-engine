from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ForecastJobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    symbol: str
    provider: str
    adjustment_type: str
    lookback: int = Field(ge=1)
    horizon: int = Field(ge=1)
    sample_count: int = Field(ge=1)

    @field_validator("symbol")
    @classmethod
    def clean_symbol(cls, value: str) -> str:
        symbol = value.strip().upper()
        if not 1 <= len(symbol) <= 20:
            raise ValueError("symbol must contain 1 to 20 characters")
        return symbol


class ForecastJobOut(BaseModel):
    id: int
    symbol: str
    provider: str
    adjustment_type: str
    lookback: int
    horizon: int
    sample_count: int
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    created_at: str
    updated_at: str
    error_message: str | None


class ForecastJobCollection(BaseModel):
    jobs: list[ForecastJobOut]
