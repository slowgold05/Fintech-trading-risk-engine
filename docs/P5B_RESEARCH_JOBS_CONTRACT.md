# Research job intake contract

Roadmap Phase 5 (AI Research Desk) section 5.2 describes a persistent job queue feeding
a bounded TradingAgents worker; section 5.4 names `POST /research/jobs`, `GET
/research/jobs/{job_id}`, and `POST /research/jobs/{job_id}/cancel` as the job-facing
API surface. This unit builds the **queue intake only**: a user can create a job, list
their own jobs, read one job's status, and cancel a still-queued one. **No worker reads
from this queue in this unit** — nothing ever transitions a job to `running`,
`completed`, or `failed` yet; that is the next, separate unit (the bounded worker
itself, which this contract deliberately does not attempt). A job created here simply
sits at `status: "queued"` until either cancelled or picked up by a worker that does not
exist yet.

## New model: `app/models/research_job.py`

```python
class ResearchJob(Base):
    __tablename__ = "research_jobs"
    __table_args__ = (
        CheckConstraint(
            "status in ('queued','running','completed','failed','cancelled')",
            name="ck_research_jobs_status",
        ),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False)
    status = Column(String(16), nullable=False, default="queued")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())
    error_message = Column(String(500), nullable=True)
```

All five `status` values are declared now (via the `CheckConstraint`) even though this
unit only ever writes `"queued"` or `"cancelled"` — the worker unit that comes next
writes the other three without needing its own migration.

The `symbol` column is a real foreign key into `market_symbols.symbol` (`ondelete=
"RESTRICT"`, mirroring `watchlist_items.symbol`'s own existing constraint) — a job can
only be created for a symbol the platform actually knows about, same referential
guarantee watchlists already have.

## New migration

Chains onto the current head (`e1a7c3b5d820`, PR #69's filings-cache migration).
`upgrade()` creates `research_jobs` with an index on `user_id` and one on `status`
(status will matter once a worker starts polling for `queued` rows). `downgrade()` drops
both indexes then the table.

## New schema: `app/schemas/research_job.py`

```python
class ResearchJobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    symbol: str  # same _symbol clean/validate convention as WatchlistSymbolCreate: strip, upper, 1-20 chars

class ResearchJobOut(BaseModel):
    id: int
    symbol: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    created_at: str   # ISO-8601, "Z" suffix, via a local _iso_z helper
    updated_at: str
    error_message: str | None

class ResearchJobCollection(BaseModel):
    jobs: list[ResearchJobOut]
```

## New routes, added to the existing `app/routers/research.py` (alongside PR #69's
`GET /research/filings/{symbol}`; that route is untouched)

- **`POST /research/jobs`** — creates a job.
  - Validates `symbol` is a known, active `MarketSymbol` (same check and same `400`
    message, `"Unknown or inactive stock symbol"`, that
    `POST /watchlists/{id}/symbols` already uses — do not invent new wording).
  - **Cap**: a user may have at most 10 jobs simultaneously in `('queued', 'running')`.
    The 11th attempt returns `409`, detail `"Too many pending research jobs. Cancel one
    before creating another."` (status can never reach `running` in this unit, but the
    cap's own query checks both statuses now so the worker unit does not need to touch
    this check later).
  - Returns `201` with the new job as `ResearchJobOut`.
- **`GET /research/jobs`** — lists the caller's own jobs, newest first (`id` descending),
  `limit` query param (`default=50, ge=1, le=100`, matching `GET /orders`'s own
  convention). Never includes another user's jobs.
- **`GET /research/jobs/{job_id}`** — ownership-scoped lookup: the query filters on
  `ResearchJob.id == job_id AND ResearchJob.user_id == owner_id` in one `WHERE` (the same
  pattern `GET /orders/{order_id}` already uses) so a job owned by a different user
  produces the same `404` as a job that does not exist at all — never a `403` that would
  leak existence.
- **`POST /research/jobs/{job_id}/cancel`** — same ownership-scoped `404`. Row-locked
  with `with_for_update()` before the status check (mirrors `order_book.cancel_order`'s
  own locking, guarding the same double-cancel race even though no worker exists yet to
  race against). If `status != "queued"`, returns `409`, detail `"Research job is no
  longer queued."` (mirrors `cancel_order`'s own `"Order is no longer open"` wording
  style). On success: `status = "cancelled"`, `updated_at` set to the current time,
  returns `200` with the updated `ResearchJobOut`.

## What this unit does not do

No worker, no TradingAgents integration, no job actually ever running — `status` never
becomes anything but `queued` or `cancelled` from this code. No `GET /research/reports`,
`GET /research/reports/{report_id}`, `GET /research/briefs`, or
`GET /research/briefs/{brief_id}` (those need a worker to produce anything to read). No
frontend. Does not touch `GET /research/filings/{symbol}` (PR #69) or any other existing
route.
