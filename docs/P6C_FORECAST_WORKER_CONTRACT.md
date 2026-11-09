# Bounded forecast worker contract

Third unit of roadmap Phase 6 (Experimental Forecast Lab) — the bounded worker that
actually drains the job queue PR #77 built intake for, mirroring PR #71's own
research-worker shape exactly (claim → run → write a result → complete/fail), plus
the result-reading routes PR #71 also added in the same PR (`GET /research/reports`
→ here, `GET /forecasts`/`GET /forecasts/{forecast_id}`).

## A real gap this unit closes: `forecast_kronos_enabled` was never wired in

PR #76 declared `settings.forecast_kronos_enabled` (default `False`) and documented
it everywhere ("this app makes zero live calls to Hugging Face Hub unless an
operator explicitly turns this on") — but `app/services/forecast_kronos.py` never
actually reads that setting; `generate_forecast` always attempts a real model load
once called. That was correct for PR #76 itself (a pure function with no caller
yet to gate), the same way PR #70's job intake never checked
`research_synthesis_enabled` either — only PR #72's worker did. **This unit is
where that gate belongs**, and it is the only remaining place it could belong: the
worker is the only code that ever calls `generate_forecast` for a real job.

Unlike Phase 5's `research_synthesis_enabled` (which gates an *optional addendum* on
top of an already-useful data-gathering job that completes either way),
Kronos inference **is** the entire point of a forecast job — there is no cheaper
fallback result to fall back to. So the worker does not skip disabled jobs silently
(which would leave them stuck `queued` forever, an unhelpful invisible failure for
whoever submitted them): it claims each job as normal and, before calling
`generate_forecast`, raises its own clear `RuntimeError` ("Kronos forecasting is
disabled (forecast_kronos_enabled is false)") if the flag is off — landing in the
same `except` branch every other exception in this worker already lands in, so the
job transitions to `"failed"` with that exact message as `error_message`, and the
operator (or the user reading their own job) learns the real reason immediately
rather than something that could later misleadingly claim "not installed" once the
dependencies genuinely are installed but the flag is still off.

## New model: `app/models/forecast_result.py`

```python
class ForecastResult(Base):
    __tablename__ = "forecast_results"

    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey("forecast_jobs.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False)
    provider = Column(String(32), nullable=False)
    adjustment_type = Column(String(20), nullable=False)
    model_name = Column(String(128), nullable=False)
    tokenizer_name = Column(String(128), nullable=False)
    lookback = Column(Integer, nullable=False)
    horizon = Column(Integer, nullable=False)
    sample_count = Column(Integer, nullable=False)
    input_cutoff = Column(String(10), nullable=False)
    generated_at = Column(DateTime, nullable=False)
    bars = Column(JSON, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
```

`job_id` is unique — a job produces at most one result (same one-to-one shape PR
#71's `ResearchReport` used for `research_jobs`). `generated_at` is stored exactly
as `generate_forecast`'s own return value states it (not re-derived) — it is the
model call's own timestamp, not this row's insert time (`created_at` is that).

## New migration

Chains onto the current head (`d8e1b4c7a902`, PR #77's `forecast_jobs` migration).
`upgrade()` creates `forecast_results` with an index on `job_id` and one on
`user_id`. `downgrade()` drops both then the table.

## New setting: `app/core/config.py`

`scheduled_forecast_job_limit: int = Field(default=1, ge=0, le=10)` — added directly
below the existing `forecast_kronos_max_sample_count` line. Default `1`, tighter
than every other scheduled-step limit in this app, reflecting PR #76's own disclosed
operational warning: a single real Kronos job can plausibly take minutes, and this
app's scheduler processes every step in one sequential cycle (research jobs,
surveillance, AML, market refresh, ...) — a higher default here would risk a single
scheduled cycle running for an unpredictable length.

## New service: `app/services/forecast_worker.py`

- `_claim_job(db) -> ForecastJob | None`: selects the oldest `queued` `ForecastJob`
  (`order_by(ForecastJob.id.asc())`), row-locked with `.with_for_update()`, sets
  `status = "running"`, bumps `updated_at`, flushes (not commits). Mirrors
  `research_worker._claim_job` exactly, same locking rationale.
- `process_one_job(db) -> ForecastJob | None`: claims one job (returns `None`
  immediately if none queued). If `not settings.forecast_kronos_enabled`, raises the
  `RuntimeError` described above (caught by this same function's own `except`
  below — not a special-cased early return, so the failure path is identical to any
  other failure). Otherwise calls
  `generate_forecast(db, symbol=job.symbol, provider=job.provider,
  adjustment_type=job.adjustment_type, lookback=job.lookback, horizon=job.horizon,
  sample_count=job.sample_count)` (every argument replayed from the stored job row,
  unchanged — PR #77's own stated reason for storing them). On success: writes a
  `ForecastResult` from the returned dict's fields, sets `job.status =
  "completed"`. On any exception (disabled flag, missing dependencies, a real
  model/data error): `job.status = "failed"`, `job.error_message =
  str(exc)[:500]`. Always bumps `updated_at` and commits once at the end.
- `process_pending_forecast_jobs(db, max_jobs) -> list[ForecastJob]`: calls
  `process_one_job` up to `max_jobs` times, stopping early the first time it
  returns `None`. The actual "bounded" guarantee, same shape as
  `research_worker.process_pending_research_jobs`.

## Wiring into the existing scheduler: `app/services/scheduled_jobs.py`

An eighth step in `_run_scheduled_steps`, same try/except/rollback/log shape as the
existing seven:

```python
try:
    forecasts = process_pending_forecast_jobs(db, settings.scheduled_forecast_job_limit)
except Exception as exc:
    db.rollback()
    forecasts = {"error": exc.__class__.__name__}
    _log(f"forecast jobs failed: {exc.__class__.__name__}")
```

Include `forecasts=...` in the final `_log(...)` line. **Must not break
`tests/test_phase2_controls.py::test_scheduled_cycle_refreshes_before_writing_controls`**
(already extended twice, for the `research` and `briefs` steps) — extend it a third
time, the same way, to mock `process_pending_forecast_jobs` too and include
`"forecasts"` in the expected call list.

## New routes, added to `app/routers/forecasts.py` (alongside the existing job
routes, all untouched)

- **`GET /forecasts`** — lists the caller's own forecast results, newest first
  (`id` descending), `limit` query param (`default=50, ge=1, le=100`).
- **`GET /forecasts/{forecast_id}`** — ownership-scoped lookup (the roadmap's own
  named route, section 6.4), same `404`-for-both pattern as every other resource in
  this app.

(These sit at `/forecasts` and `/forecasts/{forecast_id}` directly, one path segment
below the router's own prefix — distinct from `/forecasts/jobs` and
`/forecasts/jobs/{job_id}`, no route-matching ambiguity since they're different
fixed first segments.)

## New schema: `app/schemas/forecast_result.py`

```python
class ForecastBar(BaseModel):
    session_date: str
    open: float
    high: float
    low: float
    close: float
    volume: float

class ForecastResultOut(BaseModel):
    id: int
    job_id: int
    symbol: str
    provider: str
    adjustment_type: str
    model_name: str
    tokenizer_name: str
    lookback: int
    horizon: int
    sample_count: int
    input_cutoff: str
    generated_at: str
    bars: list[ForecastBar]

class ForecastResultCollection(BaseModel):
    results: list[ForecastResultOut]
```

## What this unit does not do

No chart UI. No walk-forward historical validation (roadmap 6.3 — a separate, much
larger unit with its own baseline-comparison methodology; this unit produces
individual forecasts on request, not an accuracy evaluation). No `GET
/forecasts/models` or `GET /forecasts/evaluations` (later, section 6.4 concerns). No
frontend. Does not touch `app/services/forecast_kronos.py`'s own implementation,
the job intake routes (PR #77), or any existing route.
