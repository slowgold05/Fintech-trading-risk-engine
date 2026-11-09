# Personalized daily briefs verification

Fifth unit of roadmap Phase 5 (AI Research Desk) — closes out the named API surface
(`GET /research/briefs`, `GET /research/briefs/{brief_id}`). Aggregation only: a brief
pairs each symbol a user holds with the most recent completed report for it, or
`null`. No new job creation, no new synthesis. Design written first as
`docs/P5E_RESEARCH_BRIEFS_CONTRACT.md`.

## Implemented by Grok, independently verified by me

- `app/models/research_brief.py`: new model, `ResearchBrief`.
- `alembic/versions/<new>_add_research_briefs.py`: new migration, chained onto head
  `b6e2d9a4c175`.
- `app/core/config.py`: one new setting, `scheduled_daily_brief_limit`.
- `app/services/research_briefs.py`: new file, `build_daily_brief`/
  `build_daily_briefs` and helpers.
- `app/services/scheduled_jobs.py`: one new step wired into `_run_scheduled_steps`,
  same shape as the existing six.
- `app/schemas/research_brief.py`: new file.
- `app/routers/research.py`: two new routes, existing ones untouched.
- `tests/test_research_briefs.py`: new file.

## Independent verification

- Reviewed the full diff of every touched/new file directly (not Grok's self-report).
- Confirmed `build_daily_brief` is genuinely idempotent — a test calls it twice for
  the same `(user_id, as_of_date)` with a new report appearing in between the two
  calls, and asserts the second call returns the exact same brief (same `id`, same
  `entries`), proving it does not silently rebuild on a later call.
- Confirmed `build_daily_briefs`'s bound is enforced by the query itself (a
  `NOT EXISTS`/`NOT IN` filter), not by fetching every eligible user and slicing in
  Python — a test seeds more eligible users than the limit and asserts only `limit`
  new briefs are created in one call, with the rest still missing a brief after that
  call (not created-then-discarded).
- Confirmed a user with zero holdings still gets a valid brief with `entries: []`,
  not an error.
- Confirmed the two existing scheduler tests
  (`tests/test_audit_fixes.py::test_only_one_scheduler_runs_the_cycle`,
  `tests/test_phase2_controls.py::test_scheduled_cycle_refreshes_before_writing_controls`)
  still pass unchanged — the real `build_daily_briefs` runs against each test's own
  empty-of-holdings database and returns `[]` harmlessly.
- Confirmed the ownership-scoped brief lookups match every other resource in this
  router (another user's brief 404s exactly like a nonexistent one).
- `python -m pytest -q tests/test_research_briefs.py`: **8 passed** (all new).
- `python -m pytest -q tests/test_audit_fixes.py tests/test_phase2_controls.py`:
  **28 passed** — confirmed the scheduler-step test extension (one new
  `monkeypatch.setattr(scheduled_jobs, "build_daily_briefs", ...)` line, one extra
  `"briefs"` in the expected call list) actually works this time.
- `python -m pytest -q` (full backend suite): **447 passed, 28 skipped** — up from the
  PR #72 baseline (439 passed) by exactly the 8 new tests; same 2 pre-existing
  unrelated Windows-local SQLite-locking errors.
- `python -m alembic heads`: exactly one head (`c8f1a3d7e492`, chained onto
  `b6e2d9a4c175`); grepped the repo for the previous head string before shipping and
  bumped the two Postgres-only "fresh install reaches head" assertions pre-emptively.

## What this unit does not do

Does not create research jobs, does not call the local model, does not refresh a
stale report. No automatic re-brief if holdings change mid-day. No frontend. Does not
touch `GET /research/filings/{symbol}` (PR #69), the job intake routes (PR #70), the
worker's data-gathering/synthesis (PR #71/#72), or any existing route.
