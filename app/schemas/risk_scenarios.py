from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class RiskScenarioShock(BaseModel):
    target_type: Literal["symbol", "sector"]
    target: str
    shock_pct: Decimal = Field(max_digits=18, decimal_places=4)

    @field_validator("shock_pct")
    @classmethod
    def shock_above_negative_100(cls, value: Decimal) -> Decimal:
        if value <= Decimal("-100"):
            raise ValueError("shock_pct must be greater than -100.")
        return value

    @field_validator("target")
    @classmethod
    def normalize_target(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or len(normalized) > 40:
            raise ValueError("target must contain 1 to 40 characters.")
        return normalized


class RiskScenariosRequest(BaseModel):
    shocks: list[RiskScenarioShock] = Field(min_length=1, max_length=20)
