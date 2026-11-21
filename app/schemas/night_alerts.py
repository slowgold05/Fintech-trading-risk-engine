from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.night_notebook import DecimalText, NotebookInput


AlertDirection = Literal["at_or_above", "at_or_below"]


class AlertCreate(NotebookInput):
    symbol: str = Field(pattern=r"^[A-Z0-9][A-Z0-9.\-]{0,19}$")
    direction: AlertDirection
    target: Annotated[DecimalText, Field(gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)]

    @field_validator("symbol", mode="before")
    @classmethod
    def normalize_symbol(cls, value):
        return value.strip().upper() if isinstance(value, str) else value


class AlertSource(BaseModel):
    provider: str
    basis: Literal["raw"] = "raw"
    session_date: date
    observed_at: datetime
    coverage: Literal["available"] = "available"


class AlertOut(BaseModel):
    id: int
    symbol: str
    direction: AlertDirection
    target: DecimalText
    status: Literal["armed", "triggered"]
    last_date: date | None
    last_close: DecimalText | None
    triggered_at: datetime | None
    source: AlertSource | None


class AlertCollection(BaseModel):
    items: list[AlertOut]
