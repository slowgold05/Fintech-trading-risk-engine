# Bounded research worker contract

Roadmap Phase 5 (AI Research Desk) section 5.2 describes a "bounded TradingAgents
worker" draining the job queue PR #70 built the intake for. **This unit builds the
bounded worker's mechanics — claim a queued job, run it, write a report, mark it
complete or failed — using only data sources this codebase already has (SEC
fundamentals + filings). It does not integrate TradingAgents or call any LLM.** The
report this unit produces is an honest placeholder: a `sources` list recording what
data was actually pulled, with `bull_case`/`bear_case`/`synthesis`/`risks`/
`model_version`/`prompt_version` all `null`, because no AI model has analyzed anything
yet. Reviewing and integrating an actual LLM/TradingAgents framework is a separate,
later unit that needs its own explicit scoping (model choice, cost, prompt versioning) —
this unit deliberately stops short of it.

## Why this scope, not TradingAgents itself

TradingAgents (or any LLM-based synthesis) introduces a new external dependency, real
per-call cost, and a licensing/framework review the roadmap's own exit criteria call out
separately from the worker's plumbing. Building the queue-draining mechanics first,
against data sources already proven safe in this codebase (PR #69's filings, the
pre-existing fundamentals), lets every other piece — claiming, bounding concurrency,
completing, failing, reporting — get built and tested without that open decision
blocking it.

## New model: `app/models/research_report.py`

```python
class ResearchReport(Base):
    __tablename__ = "research_reports"

    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey("research_jobs.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    sources = Column(JSON, nullable=False)
    bull_case = Column(Text, nullable=True)
    bear_case = Column(Text, nullable=True)
    synthesis = Column(Text, nullable=True)
    risks = Column(Text, nullable=True)
    model_version = Column(String(64), nullable=True)
    prompt_version = Column(String(64), nullable=True)
```

`job_id` is unique: a job produces at most one report (one-to-one, enforced at the DB
level, not just by convention).

## New migration

Chains onto the current head (`c9e4a7b2d618`, PR #70's research-jobs migration).
`upgrade()` creates `research_reports` with an index on `job_id` (the unique constraint
already implies an index on most backends, but create an explicit named index anyway
for clarity, same as every other table in this codebase) and one on `user_id`.
`downgrade()` drops both indexes then the table.

## New setting: `app/core/config.py`

`scheduled_research_job_limit: int = Field(default=5, ge=0, le=50)` — added directly
below the existing `scheduled_market_daily_limit` line. Mirrors that field's own
`ge=0` convention: `0` means the scheduled cycle processes no research jobs (an opt-out
dial, not a separate enable/disable flag — this codebase has one scheduler on/off
switch, `scheduled_jobs_enabled`, not a per-step one).

## New service: `app/services/research_worker.py`

- `_claim_job(db) -> ResearchJob | None`: selects the oldest `queued` job
  (`order_by(ResearchJob.id.asc())`), row-locked with `.with_for_update()` (no
  `skip_locked` — this app runs one scheduler thread per process already serialized by
  `acquire_scheduler`'s own cycle-level lock, same as every other step in
  `scheduled_jobs.py`; `skip_locked` is a multi-worker-process concern this
  architecture does not have). Sets `status = "running"`, bumps `updated_at`, flushes
  (not commits — the caller commits once the whole job's outcome is known), returns the
  job, or `None` if no job is queued.
- `_gather_sources(db, symbol) -> list[dict]`: calls `get_sec_company_fundamentals` and
  `get_sec_company_filings(symbol, db, limit=5)` **independently**, each in its own
  `try`/`except` — one source failing (e.g. a symbol with no XBRL fundamentals) must
  never prevent the other source's result from being recorded, and must never fail the
  job. Each entry: `{"type": "sec_fundamentals" | "sec_filings", "status": "ok" |
  "unavailable", "detail": <short string>}`. A job with every source unavailable still
  **completes** — `sources` just ends up documenting that nothing was available
  (`status: "unavailable"` is a legitimate measured result for that source, not a
  reason to fail the overall job).
- `process_one_job(db) -> ResearchJob | None`: claims one job (returns `None`
  immediately if none queued); gathers sources; on success, writes a `ResearchReport`
  (all AI-synthesis fields `None`) and sets the job's `status = "completed"`; on any
  unexpected exception past `_gather_sources` (DB-level failure, not a data-source
  failure — those are already caught inside `_gather_sources`), sets `status =
  "failed"`, `error_message = str(exc)[:500]`. Always bumps `updated_at` and commits
  once, at the end, regardless of outcome.
- `process_pending_research_jobs(db, max_jobs) -> list[ResearchJob]`: calls
  `process_one_job` up to `max_jobs` times, stopping early the first time it returns
  `None` (queue drained). **This is the "bounded" in "bounded worker"**: a single
  scheduled cycle never processes more than `max_jobs` jobs, however many are queued.

## Wiring into the existing scheduler: `app/services/scheduled_jobs.py`

Add a sixth step to `_run_scheduled_steps`, in the exact same
try/except-rollback-and-log shape as the existing five steps (`refresh_market_caches`,
`run_app_controls`, `backfill_missing_file_evidence`, `run_live_surveillance`,
`run_live_aml`):

```python
try:
    research = process_pending_research_jobs(db, settings.scheduled_research_job_limit)
except Exception as exc:
    db.rollback()
    research = {"error": exc.__class__.__name__}
    _log(f"research jobs failed: {exc.__class__.__name__}")
```

Include `research=...` in the final `_log(...)` line alongside the existing fields.
**Must not break the existing two scheduler tests**
(`tests/test_audit_fixes.py::test_only_one_scheduler_runs_the_cycle`,
`tests/test_phase2_controls.py`'s own `run_scheduled_cycle` test) — neither monkeypatches
every step, so the real `process_pending_research_jobs` will run against each test's own
empty `research_jobs` table; it must return `[]` harmlessly and must not append
anything unexpected to either test's own tracked `calls` list that would break their
exact-list assertions. Read both tests before changing this file.

## New schema: `app/schemas/research_report.py`

```python
class ResearchReportOut(BaseModel):
    id: int
    job_id: int
    symbol: str
    created_at: str
    sources: list[dict]
    bull_case: str | None
    bear_case: str | None
    synthesis: str | None
    risks: str | None
    model_version: str | None
    prompt_version: str | None

class ResearchReportCollection(BaseModel):
    reports: list[ResearchReportOut]
```

## New routes, added to `app/routers/research.py` (alongside the existing filings and
jobs routes, all untouched)

- **`GET /research/reports`** — lists the caller's own reports, newest first (`id`
  descending), `limit` query param (`default=50, ge=1, le=100`), same convention as
  `GET /research/jobs`.
- **`GET /research/reports/{report_id}`** — ownership-scoped lookup (`WHERE
  ResearchReport.id == report_id AND ResearchReport.user_id == owner_id`, `404` for a
  nonexistent or not-owned id — same pattern as the job routes, never a `403`).

No changes to the existing job routes or their response shape — correlating a
completed job to its report is done by calling `GET /research/reports` and matching
`job_id`, not by embedding a report reference on the job itself (keeps this unit from
re-touching PR #70's already-shipped code).

## What this unit does not do

No TradingAgents integration, no LLM call, no `bull_case`/`bear_case`/`synthesis`/
`risks` content — those fields exist now so the next unit (actual AI synthesis) needs
no further migration, but they are always `null` from this code. No automatic retry of
a `failed` job (a user would need to create a new job). No frontend. Does not touch
`GET /research/filings/{symbol}` (PR #69) or the job intake routes (PR #70).
