# Personalized daily briefs contract

The fifth unit of roadmap Phase 5 (AI Research Desk), closing out the named API
surface in section 5.4: `GET /research/briefs`, `GET /research/briefs/{brief_id}`.
Roadmap section 5.3 describes a personalized daily brief; this unit's scope is
**aggregation only** — a brief is a per-user, per-day snapshot pairing each symbol the
user currently holds with the most recent completed `ResearchReport` for that symbol
(or `null` if none exists yet). It does **not** create new research jobs, call the
local model, or do any new synthesis — it reads what PR #70/#71/#72 already produce.

## Why aggregation only, not a new synthesis step

The roadmap's own exit criteria call out "reproducible/deduplicated briefs" and a
"measured latency/cost budget" as separate concerns from the worker itself. Building
the aggregation/read path first — against reports that already exist — lets
"one brief per user per day, never duplicated" be proven without also deciding whether
a brief should trigger fresh job creation (a bigger, separate design question: should a
stale report be refreshed automatically? at what cost/frequency? that is explicitly
deferred, not answered here).

## New model: `app/models/research_brief.py`

```python
class ResearchBrief(Base):
    __tablename__ = "research_briefs"
    __table_args__ = (
        UniqueConstraint("user_id", "brief_date", name="uq_research_briefs_user_date"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    brief_date = Column(Date, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    entries = Column(JSON, nullable=False)
```

`entries` is a list of `{"symbol": str, "report_id": int | None}` — one entry per
symbol the user held (quantity `> 0`) at the moment the brief was built. `report_id` is
`null` when no completed report exists yet for that symbol for that user (a holding
with no research done is a legitimate, non-error state — same "missing data is a
measured null, not an error" rule every prior unit in this phase has followed).

The `(user_id, brief_date)` unique constraint is the actual "deduplicated" guarantee:
the DB itself refuses a second row for the same user and day, not just application
logic remembering not to call build twice.

## New migration

Chains onto the current head (`b6e2d9a4c175`, PR #71's research-reports migration — PR
#72 added no migration). `upgrade()` creates `research_briefs` with an index on
`user_id` and a unique index on `(user_id, brief_date)`. `downgrade()` drops both then
the table.

## New setting: `app/core/config.py`

`scheduled_daily_brief_limit: int = Field(default=20, ge=0, le=200)` — added directly
below the existing `research_prompt_version` line. Bounds how many **new** briefs (for
users who do not already have one for today) a single scheduled cycle builds. Same
`ge=0` opt-out convention as every other scheduled-step limit in this codebase.

## New service: `app/services/research_briefs.py`

- `_held_symbols(db, user_id) -> list[str]`: distinct `Asset.symbol` for every
  `Holding` with `quantity > 0` belonging to `user_id` (join `Holding.asset_id ==
  Asset.id`), sorted alphabetically (a stable, deterministic order — not insertion
  order, which could vary run to run).
- `_latest_report_id(db, user_id, symbol) -> int | None`: the highest-`id`
  `ResearchReport` row for that exact `(user_id, symbol)` pair, or `None` if none
  exists.
- `build_daily_brief(db, user_id, as_of_date) -> ResearchBrief`: **idempotent** — if a
  `ResearchBrief` already exists for `(user_id, as_of_date)`, returns that existing row
  unchanged (does not rebuild or overwrite it, even if a newer report has since
  appeared — a brief is a snapshot at the moment it was first built that day, not a
  live view; this is the "reproducible" half of the roadmap's own exit criterion:
  re-reading the same brief later gives the same answer). Otherwise: computes
  `_held_symbols`, looks up each one's `_latest_report_id`, builds the `entries` list,
  creates and commits a new `ResearchBrief`, and returns it. A user with zero holdings
  still gets a brief — `entries: []` is a legitimate result, not an error.
- `build_daily_briefs(db, max_users, as_of_date=None) -> list[ResearchBrief]`:
  `as_of_date` defaults to `datetime.now(timezone.utc).date()`. Finds up to `max_users`
  distinct `user_id`s that have at least one `Holding` with `quantity > 0` **and do not
  already have a `ResearchBrief` for `as_of_date`** (an `IN`/`NOT IN` or `NOT EXISTS`
  query — do not fetch every holder and filter in Python, which would not actually
  bound the work done), ordered by `user_id` ascending for determinism, and calls
  `build_daily_brief` for each. **This is the "bounded" guarantee**: a cycle never
  builds more than `max_users` new briefs, however many users are eligible.

## Wiring into the existing scheduler: `app/services/scheduled_jobs.py`

A seventh step in `_run_scheduled_steps`, same try/except/rollback/log shape as the
other six (including the research-jobs step PR #71 added):

```python
try:
    briefs = build_daily_briefs(db, settings.scheduled_daily_brief_limit)
except Exception as exc:
    db.rollback()
    briefs = {"error": exc.__class__.__name__}
    _log(f"daily briefs failed: {exc.__class__.__name__}")
```

Include `briefs=...` in the final `_log(...)` line. Must not break either of the two
existing scheduler tests that don't mock every step
(`tests/test_audit_fixes.py::test_only_one_scheduler_runs_the_cycle`,
`tests/test_phase2_controls.py::test_scheduled_cycle_refreshes_before_writing_controls`)
— the real `build_daily_briefs` must run harmlessly against each test's own database
(no holders with `quantity > 0` in either test's fixtures, so it returns `[]`) without
appending anything to either test's own tracked-call-list. Read both tests (and PR
#71's own fix to the second one) before changing this file.

## New schema: `app/schemas/research_brief.py`

```python
class ResearchBriefEntry(BaseModel):
    symbol: str
    report_id: int | None

class ResearchBriefOut(BaseModel):
    id: int
    brief_date: str  # "YYYY-MM-DD"
    created_at: str  # ISO-8601, "Z" suffix
    entries: list[ResearchBriefEntry]

class ResearchBriefCollection(BaseModel):
    briefs: list[ResearchBriefOut]
```

## New routes, added to `app/routers/research.py` (alongside the existing filings,
job, and report routes, all untouched)

- **`GET /research/briefs`** — lists the caller's own briefs, newest first
  (`brief_date` descending, then `id` descending as a tiebreak), `limit` query param
  (`default=30, ge=1, le=100`).
- **`GET /research/briefs/{brief_id}`** — ownership-scoped lookup, same `404`-for-both
  pattern as every other resource in this router.

## What this unit does not do

Does not create research jobs, does not call the local model, does not refresh a
report that has gone stale — a brief only ever points at whatever `ResearchReport`
already exists (or `null`) at build time. No automatic re-brief if a user's holdings
change mid-day. No frontend. Does not touch `GET /research/filings/{symbol}` (PR #69),
the job intake routes (PR #70), the worker's own data-gathering/synthesis (PR #71/#72),
or any existing route.
