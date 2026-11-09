# Forecast job intake contract

Second unit of roadmap Phase 6 (Experimental Forecast Lab) — the job-queue **intake**
surface named in section 6.4: `POST /forecasts/jobs`, `GET /forecasts/jobs/{job_id}`,
`POST /forecasts/jobs/{job_id}/cancel`, plus `GET /forecasts/jobs` for listing
(matching the convention Phase 5's `GET /research/jobs` already established beyond
what the roadmap named explicitly there too). **No worker exists yet** — mirrors PR
#70's own exact scope-split for research jobs: a job only ever reaches `queued` (on
creation) or `cancelled` (via cancel) from this unit; the bounded worker that
actually calls `app.services.forecast_kronos.generate_forecast` is a separate, later
unit (6.C).

## Why a forecast job needs more stored fields than a research job

PR #70's `ResearchJob` only needed a `symbol` — the worker's own data gathering
decided everything else. A forecast job's parameters (`provider`, `adjustment_type`,
`lookback`, `horizon`, `sample_count`) are exactly `generate_forecast`'s own keyword
arguments (PR #76) — they must be captured at request time and stored, not
re-derived later, since the worker (6.C) needs to replay them unchanged.

## New model: `app/models/forecast_job.py`

```python
class ForecastJob(Base):
    __tablename__ = "forecast_jobs"
    __table_args__ = (
        CheckConstraint(
            "status in ('queued','running','completed','failed','cancelled')",
            name="ck_forecast_jobs_status",
        ),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False)
    provider = Column(String(32), nullable=False)
    adjustment_type = Column(String(20), nullable=False)
    lookback = Column(Integer, nullable=False)
    horizon = Column(Integer, nullable=False)
    sample_count = Column(Integer, nullable=False)
    status = Column(String(16), nullable=False, default="queued")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())
    error_message = Column(String(500), nullable=True)
```

Same five-value `status` check constraint PR #70 used — `running`/`completed`/
`failed` are declared now even though this unit never writes them, so the worker
unit (6.C) needs no further migration.

## New migration

Chains onto the current head (`a9c3e7d1f504`, PR #76's `backend_detail` column — no
migration in between). `upgrade()` creates `forecast_jobs` with an index on
`user_id` and one on `status`. `downgrade()` drops both then the table.

## New schema: `app/schemas/forecast_job.py`

```python
class ForecastJobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    symbol: str
    provider: str
    adjustment_type: str
    lookback: int = Field(ge=1)
    horizon: int = Field(ge=1)
    sample_count: int = Field(ge=1)

    @field_validator("symbol")
    @classmethod
    def clean_symbol(cls, value: str) -> str:
        symbol = value.strip().upper()
        if not 1 <= len(symbol) <= 20:
            raise ValueError("symbol must contain 1 to 20 characters")
        return symbol

class ForecastJobOut(BaseModel):
    id: int
    symbol: str
    provider: str
    adjustment_type: str
    lookback: int
    horizon: int
    sample_count: int
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    created_at: str
    updated_at: str
    error_message: str | None

class ForecastJobCollection(BaseModel):
    jobs: list[ForecastJobOut]
```

`lookback`/`horizon`/`sample_count` only get a Pydantic sanity floor (`ge=1`) — the
actual upper bounds live in `settings.forecast_kronos_max_*` (runtime config, not a
compile-time schema constant) and are checked at the route/service level, same
reasoning PR #76 itself already used for those same three fields.

## New routes, new `app/routers/forecasts.py` (new file, mounted at `/forecasts` in
`app/main.py` — the first route under this prefix, same bootstrapping PR #69 did for
`/research`)

- **`POST /forecasts/jobs`** — creates a job.
  - Validates `symbol` is a known, active `MarketSymbol`, reusing the exact existing
    `400`/`"Unknown or inactive stock symbol"` check and message
    `POST /watchlists/{id}/symbols` and `POST /research/jobs` both already use — do
    not invent new wording.
  - Validates `adjustment_type` is in `market_history.SUPPORTED_ADJUSTMENTS`
    (`{"raw", "split_adjusted"}`) — `422` otherwise (reuses the existing frozenset
    constant; does not duplicate it).
  - Validates `lookback <= settings.forecast_kronos_max_lookback`,
    `horizon <= settings.forecast_kronos_max_horizon`,
    `sample_count <= settings.forecast_kronos_max_sample_count` — `422` with a
    readable message otherwise (the same three bounds `generate_forecast` itself
    checks — checking them again at intake means a request that will definitely be
    rejected later never even reaches the queue).
  - **Cap**: a user may have at most **5** jobs simultaneously in `('queued',
    'running')` — tighter than research jobs' cap of 10 (PR #70), reflecting that a
    real Kronos inference call is far more compute-heavy per job than a data-gathering
    research job. The 6th attempt returns `409`, detail `"Too many pending forecast
    jobs. Cancel one before creating another."`
  - Returns `201` with the new job as `ForecastJobOut`.
- **`GET /forecasts/jobs`** — lists the caller's own jobs, newest first (`id`
  descending), `limit` query param (`default=50, ge=1, le=100`), same convention as
  `GET /research/jobs`.
- **`GET /forecasts/jobs/{job_id}`** — ownership-scoped lookup (`WHERE
  ForecastJob.id == job_id AND ForecastJob.user_id == owner_id` in one `WHERE`), same
  `404`-for-both-nonexistent-and-not-owned pattern as every other resource in this
  app — never a `403`.
- **`POST /forecasts/jobs/{job_id}/cancel`** — same ownership-scoped `404`, row-locked
  with `.with_for_update()` before the status check (mirrors
  `order_book.cancel_order`/PR #70's own cancel route). `409`, detail `"Forecast job
  is no longer queued."` if `status != "queued"`. On success: `status = "cancelled"`,
  `updated_at` bumped, returns `200` with the updated `ForecastJobOut`.

## What this unit does not do

No worker, no TradingAgents-style synthesis step, no actual Kronos inference —
`status` never becomes anything but `queued` or `cancelled` from this code (same as
PR #70's own disclosed scope for research jobs). No `GET /forecasts/{forecast_id}`
(a completed forecast's own result — that needs the worker to exist first; a
separate, later unit, same decoupled-resource shape Phase 5 used for jobs vs.
reports). No `GET /forecasts/models` or `GET /forecasts/evaluations` (also later,
section 6.3/6.4 concerns). No frontend. Does not touch any existing route, including
`GET /research/filings/{symbol}`, the research job intake routes, or
`app/services/forecast_kronos.py`'s own `generate_forecast` (called, never modified).
