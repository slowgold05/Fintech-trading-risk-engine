import re
from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, field_validator

from app.services.exchange_calendar import is_nyse_trading_day


def _decimal_input(value: object) -> object:
    if isinstance(value, str) and not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", value):
        raise ValueError("Use a plain decimal amount in USD.")
    return value


InitialUSD = Annotated[
    Decimal, BeforeValidator(_decimal_input), Field(gt=0, le=1_000_000, decimal_places=2, allow_inf_nan=False)
]
Symbol = Annotated[
    str, StringConstraints(min_length=1, max_length=20, to_upper=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9.-]*$")
]


class BacktestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: Symbol
    start: date
    end: date
    initial_usd: InitialUSD

    @field_validator("start", "end", mode="before")
    @classmethod
    def validate_session_date(cls, value: object) -> date:
        if isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            value = date.fromisoformat(value)
        if not isinstance(value, date) or isinstance(value, datetime):
            raise ValueError("Use a date in YYYY-MM-DD format.")
        is_nyse_trading_day(value)  # Also checks the supported calendar bounds.
        return value

    @field_validator("end")
    @classmethod
    def validate_window(cls, end: date, info) -> date:
        start = info.data.get("start")
        if start is not None:
            year = start.year + 3
            last_day = monthrange(year, start.month)[1]
            limit = date(year, start.month, min(start.day, last_day))
            if not start <= end <= limit:
                raise ValueError("End must be on or after start and within three calendar years.")
        return end


Coverage = Literal["available", "partial", "missing", "stale"]


class SimulationSource(BaseModel):
    provider: str
    basis: Literal["split_adjusted"] = "split_adjusted"
    session_date: date
    observed_at: datetime
    coverage: Coverage


class SimulationPoint(BaseModel):
    session_date: date
    value_usd: Decimal
    contributed_usd: Decimal


class Simulation(BaseModel):
    symbol: str
    mode: Literal["backtest"]
    coverage: Coverage
    source: SimulationSource | None = None
    start_used: date | None = None
    end_used: date | None = None
    contributed_usd: Decimal | None = None
    end_value_usd: Decimal | None = None
    price_return: Decimal | None = None
    points: list[SimulationPoint] = Field(default_factory=list)
    skipped_months: list[str] = Field(default_factory=list)
    assumptions: list[str]


class SimulationErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, str] | None = None


class SimulationError(BaseModel):
    detail: SimulationErrorDetail
