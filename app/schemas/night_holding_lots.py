from datetime import date, datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel


Coverage = Literal["available", "partial", "missing", "stale"]
Row = TypeVar("Row")


class Page(BaseModel, Generic[Row]):
    items: list[Row]
    next_cursor: str | None


class MarkSource(BaseModel):
    provider: str
    basis: Literal["raw"] = "raw"
    session_date: date | None
    observed_at: datetime | None
    coverage: Literal["available"] = "available"


class Mark(BaseModel):
    price: str
    source: MarkSource


class LotRow(BaseModel):
    id: int
    recorded_at: datetime
    quantity_remaining: str
    cost_per_share: str
    cost_basis_usd: str
    unrealized_pnl_usd: str | None


class SaleRow(BaseModel):
    trade_id: int
    order_id: int | None
    executed_at: datetime
    quantity: str
    fill_price: str
    proceeds_usd: str
    realized_pnl_usd: str
    demo_seed: bool


class HoldingLots(BaseModel):
    symbol: str
    read_at: datetime
    book_started_on: date | None
    coverage: Coverage
    quantity: str
    cost_basis_usd: str | None
    market_value_usd: str | None
    unrealized_pnl_usd: str | None
    realized_pnl_usd: str
    mark: Mark | None
    lots: Page[LotRow]
    sales: Page[SaleRow]
    reason: str | None
