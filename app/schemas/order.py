from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class OrderCreate(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    order_type: Literal["limit", "market"] = "limit"
    quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=6)
    limit_price: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)

    @model_validator(mode="after")
    def price_matches_type(self):
        if (self.order_type == "limit") != (self.limit_price is not None):
            raise ValueError("limit orders require a price; market orders cannot set one")
        if self.limit_price is not None and self.quantity * self.limit_price < Decimal("0.005"):
            raise ValueError("limit order value must be at least $0.01")
        return self

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        symbol = value.strip().upper()
        if not symbol or len(symbol) > 20:
            raise ValueError("symbol must contain 1 to 20 characters")
        return symbol
