from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator


def _clean_symbol(value: str) -> str:
    symbol = value.strip().upper()
    if not 1 <= len(symbol) <= 20:
        raise ValueError("symbol must contain 1 to 20 characters")
    return symbol


class ResearchJobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    symbol: str

    @field_validator("symbol")
    @classmethod
    def clean_symbol(cls, value: str) -> str:
        return _clean_symbol(value)


class ResearchJobOut(BaseModel):
    id: int
    symbol: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    created_at: str
    updated_at: str
    error_message: str | None


class ResearchJobCollection(BaseModel):
    jobs: list[ResearchJobOut]
