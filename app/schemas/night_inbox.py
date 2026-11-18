from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


EVENT_KEY_PATTERN = r"^(?:(?:fill|alert_triggered):[1-9][0-9]{0,9}|demo_(?:started|reset):[0-9a-f]{32})$"
InboxFilter = Literal["all", "unread"]
InboxKind = Literal["fill", "alert_triggered", "demo_started", "demo_reset"]


class InboxQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filter: InboxFilter = "all"
    cursor: str | None = Field(None, min_length=1, max_length=256)
    limit: int = Field(25, ge=1, le=50)


class InboxProvenance(BaseModel):
    provider: str
    basis: Literal["raw", "split_adjusted", "filing", "publisher"]
    session_date: date | None
    observed_at: datetime | None
    coverage: Literal["available", "partial", "missing", "stale"]


class InboxItem(BaseModel):
    id: str
    kind: InboxKind
    occurred_at: datetime
    read_at: datetime | None
    symbol: str | None = None
    order_id: int | None = None
    alert_id: int | None = None
    side: Literal["buy", "sell"] | None = None
    quantity: str | None = None
    price: str | None = None
    target: str | None = None
    session_date: date | None = None
    source: InboxProvenance | None = None


class InboxSources(BaseModel):
    fills: Literal[True] = True
    demo: bool
    alerts: bool = False


class InboxPage(BaseModel):
    items: list[InboxItem]
    next_cursor: str | None
    unread_count: int
    history_days: Literal[30] = 30
    sources: InboxSources
    read_at: datetime


class InboxRead(BaseModel):
    id: str
    read_at: datetime
