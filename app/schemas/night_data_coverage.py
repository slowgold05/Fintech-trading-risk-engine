from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, PlainSerializer


Coverage = Literal["available", "partial", "missing", "stale"]
Basis = Literal["raw", "split_adjusted"]
ExecutionReference = Literal["eligible", "unconfirmed", "stale", "unsupported"]
Price = Annotated[Decimal, PlainSerializer(lambda value: format(value, "f"), return_type=str)]


class Provenance(BaseModel):
    provider: str
    basis: Literal["raw", "split_adjusted", "filing", "publisher"]
    session_date: date | None
    observed_at: datetime | None
    coverage: Coverage


class UniverseCoverage(BaseModel):
    population: Literal["active_non_test_non_etf"] = "active_non_test_non_etf"
    eligible: int


class QuoteCensus(BaseModel):
    present: int
    missing: int
    invalid: int
    fresh_eod: int
    stale: int
    unconfirmed_or_other: int


class HistoryCoverage(BaseModel):
    provider: str
    basis: Basis
    valid_symbols: int
    valid_rows: int
    flagged_rows: int
    rejected_rows: int
    latest_valid_session: date | None
    valid_symbols_on_expected_session: int


class ReferenceObservation(BaseModel):
    cached_rows: int
    latest_observed_at: datetime | None


class CorporateActionCoverage(BaseModel):
    mode: Literal["verified_events_only"] = "verified_events_only"


class ReferenceCoverage(BaseModel):
    news: ReferenceObservation
    filings: ReferenceObservation
    dividends_splits: CorporateActionCoverage = CorporateActionCoverage()


class SymbolQuote(BaseModel):
    price: Price
    source: Provenance
    execution_reference: ExecutionReference


class SymbolHistory(BaseModel):
    provider: str
    basis: Basis
    start: date
    end: date
    expected_sessions: int
    observed_sessions: int
    missing_recent_sessions: list[date]
    flagged_or_rejected_sessions: int


class SymbolCoverage(BaseModel):
    symbol: str
    quote: SymbolQuote | None
    history: list[SymbolHistory]
    reason: str | None


class CoverageReport(BaseModel):
    read_at: datetime
    expected_session: date
    coverage: Coverage
    universe: UniverseCoverage
    quotes: QuoteCensus
    history: list[HistoryCoverage]
    reference: ReferenceCoverage
    symbol: SymbolCoverage | None


class NightErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, str] | None = None


class NightError(BaseModel):
    detail: NightErrorDetail
