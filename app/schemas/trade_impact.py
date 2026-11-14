from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class TradeImpactRequest(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=6)
    reference_price: Decimal = Field(gt=0, max_digits=18, decimal_places=6)
    order_type: Literal["market", "limit"] = "market"

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        symbol = value.strip().upper()
        if not symbol or len(symbol) > 20:
            raise ValueError("symbol must contain 1 to 20 characters")
        return symbol
