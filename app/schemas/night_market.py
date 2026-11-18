"""Wire models for cached public market reads."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, PlainSerializer

Coverage = Literal["available", "partial", "missing", "stale"]
PriceBasis = Literal["raw", "split_adjusted"]
WireDecimal = Annotated[Decimal, PlainSerializer(lambda value: format(value, "f"), when_used="json")]


class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, str] | None = None


class NightError(BaseModel):
    detail: ErrorDetail


class Provenance(BaseModel):
    provider: str
    basis: Literal["raw", "split_adjusted", "filing", "publisher"]
    session_date: date | None
    observed_at: datetime | None
    coverage: Coverage


class SessionCoverage(BaseModel):
    session_date: date | None
    previous_session_date: date | None
    price_type: Literal["end_of_day"] = "end_of_day"
    coverage: Coverage
    universe_count: int
    covered_count: int


class ScreenerItem(BaseModel):
    symbol: str
    name: str
    sector: str | None
    close: WireDecimal
    move: WireDecimal
    detail_available: bool
    source: Provenance


class Screener(SessionCoverage):
    matched_count: int
    items: list[ScreenerItem]
    limit: int
    offset: int


class CompareSeries(BaseModel):
    symbol: str
    source: Provenance
    returns: list[WireDecimal | None]
    missing_sessions: int


class Compare(BaseModel):
    coverage: Coverage
    base_date: date | None
    dates: list[date]
    series: list[CompareSeries]
    price_type: Literal["end_of_day"] = "end_of_day"
    return_type: Literal["price_return"] = "price_return"


class BreadthItem(BaseModel):
    symbol: str
    move: WireDecimal
    source: Provenance


class SectorBreadth(BaseModel):
    sector: str
    covered: int
    median_move: WireDecimal | None
    proxy: BreadthItem | None


class Breadth(SessionCoverage):
    excluded_count: int
    advancing: int
    declining: int
    flat: int
    sectors: list[SectorBreadth]
    items: list[BreadthItem]


class NewsItem(BaseModel):
    id: str
    title: str
    publisher: str
    url: str
    published_at: datetime
    symbols: list[str]


class News(BaseModel):
    coverage: Coverage
    as_of: datetime | None
    items: list[NewsItem]


EventKind = Literal["filing", "dividend", "split"]


class MarketEvent(BaseModel):
    kind: EventKind
    date: date
    title: str
    url: str
    source: Provenance
    form: str | None = None
    cash_per_share: WireDecimal | None = None
    currency: str | None = None
    ratio: WireDecimal | None = None


class Events(BaseModel):
    symbol: str
    coverage: Coverage
    coverage_by_kind: dict[EventKind, Coverage]
    items: list[MarketEvent]
