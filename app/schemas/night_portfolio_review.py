"""Wire types for the owned portfolio review."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

Window = Literal["1m", "3m", "ytd", "1y"]
Coverage = Literal["available", "partial", "missing", "stale"]
PriceBasis = Literal["raw", "split_adjusted"]


class Observation(BaseModel):
    symbol: str
    provider: str
    basis: PriceBasis
    from_date: date
    to_date: date


class ReviewMetrics(BaseModel):
    return_ratio: str | None
    spy_return_ratio: str | None
    excess_return_ratio: str | None
    max_drawdown_ratio: str | None
    annualized_volatility_ratio: str | None
    beta_to_spy: str | None
    correlation_to_spy: str | None
    daily_sample_count: int
    paired_sample_count: int


class ReviewPoint(BaseModel):
    session_date: date
    portfolio_return_ratio: str | None
    spy_return_ratio: str | None
    drawdown_ratio: str | None


class SectorExposure(BaseModel):
    sector: str
    value_usd: str
    weight_ratio: str | None


class ReviewExposure(BaseModel):
    as_of: datetime | None
    coverage: Coverage
    cash_weight_ratio: str | None
    sectors: list[SectorExposure]
    unpriced_symbols: list[str]


class ContributionItem(BaseModel):
    symbol: str
    pnl_usd: str


class ReviewContribution(BaseModel):
    coverage: Coverage
    scope: Literal["period"] = "period"
    items: list[ContributionItem]
    residual_usd: str | None
    reason: str | None


class PortfolioReview(BaseModel):
    window: Window
    read_at: datetime
    coverage: Coverage
    requested_start: date
    requested_end: date
    start_used: date | None
    end_used: date | None
    expected_sessions: int
    valued_sessions: int
    missing_sessions: list[date]
    observations: list[Observation]
    metrics: ReviewMetrics
    points: list[ReviewPoint]
    exposure: ReviewExposure
    contribution: ReviewContribution
    assumptions: list[str]
