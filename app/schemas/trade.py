from typing import Literal
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


class TradeCreate(BaseModel):
    symbol: str
    asset_type: Literal["stock", "crypto"]
    side: Literal["buy", "sell"]
    quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=6)

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        symbol = value.strip().upper()
        if not symbol:
            raise ValueError("symbol is required")
        return symbol


class TradeOut(BaseModel):
    trade_id: int
    risk_score: int
