# Bounded research worker verification

Third unit of roadmap Phase 5 (AI Research Desk) — the bounded worker mechanics that
drain the job queue PR #70 built intake for: claim, run, report, complete/fail. **No
TradingAgents or LLM integration** — the report this unit produces only ever documents
which already-existing data sources (SEC fundamentals, SEC filings) were available;
every AI-synthesis field is `null`. Design written first as
`docs/P5C_RESEARCH_WORKER_CONTRACT.md`.

## Implemented by Grok, independently verified by me

- `app/models/research_report.py`: new model, `ResearchReport`.
- `alembic/versions/<new>_add_research_reports.py`: new migration, chained onto head
  `c9e4a7b2d618`.
- `app/core/config.py`: one new setting, `scheduled_research_job_limit`.
- `app/services/research_worker.py`: new file, `process_pending_research_jobs` and its
  helpers.
- `app/services/scheduled_jobs.py`: one new step wired into `_run_scheduled_steps`,
  same try/except/rollback/log shape as the existing five.
- `app/schemas/research_report.py`: new file.
- `app/routers/research.py`: two new routes (`GET /research/reports`,
  `GET /research/reports/{report_id}`) added alongside the existing filings and job
  routes, all untouched.
- `tests/test_research_worker.py`: new file (the worker's own claim/complete/fail
  behavior, and the two new report routes).

## Independent verification

- Reviewed the full diff of every touched/new file directly (not Grok's self-report).
- Confirmed `_gather_sources` catches each data source's own failure independently —
  a test forces `get_sec_company_fundamentals` to fail while `get_sec_company_filings`
  succeeds (and vice versa) and asserts the job still `completes`, with the `sources`
  list correctly recording one `"ok"` and one `"unavailable"` entry, not a failed job.
- Confirmed `process_pending_research_jobs(db, max_jobs)` never processes more than
  `max_jobs` jobs in one call even when more are queued (the actual "bounded" proof) —
  a test seeds more queued jobs than the limit and asserts the excess stay `queued`.
- Confirmed the two existing scheduler tests
  (`tests/test_audit_fixes.py::test_only_one_scheduler_runs_the_cycle`,
  `tests/test_phase2_controls.py`'s `run_scheduled_cycle` test) still pass unchanged —
  the real (unmocked) `process_pending_research_jobs` runs against each test's own
  empty table and returns `[]` harmlessly, without disturbing either test's exact
  tracked-call-list assertion.
- Confirmed the ownership-scoped report lookups match the job routes' own pattern
  (another user's report 404s exactly like a nonexistent one).
- `python -m pytest -q tests/test_research_worker.py`: **7 passed** (all new).
- `python -m pytest -q` (full backend suite): **431 passed, 28 skipped** — up from the
  PR #70 baseline (424 passed) by exactly the 7 new tests; same 2 pre-existing unrelated
  Windows-local SQLite-locking errors.
- `python -m alembic heads`: exactly one head (`b6e2d9a4c175`, chained onto
  `c9e4a7b2d618`); grepped the repo for the previous head string before shipping and
  bumped the two Postgres-only "fresh install reaches head" assertions pre-emptively,
  same as PR #70 did for PR #69's migration.
- **Found and fixed one real issue in Grok's own diff**: `_claim_job` had an
  unmotivated defensive guard (`if not callable(getattr(db, "execute", None)): return
  None`) with a comment about "a session double that only implements rollback." I
  removed it as unexplained dead code without first checking why it was there — that
  was a mistake. Removing it broke a pre-existing test,
  `tests/test_phase2_controls.py::test_scheduled_cycle_refreshes_before_writing_controls`,
  whose fake `Session` double implements only `rollback()`: the real (unmocked)
  `process_pending_research_jobs` crashed with `AttributeError` on `db.execute`, and the
  new scheduler step's own `except` block called `db.rollback()`, appending an
  unexpected `"rollback"` to that test's exact tracked-call-list assertion. The guard
  Grok wrote was the correct, deliberate fix for this real pre-existing test, not dead
  code. Reverted the production-code guard and instead extended that test's own mocks
  to cover the new sixth step (`process_pending_research_jobs`), matching the exact
  pattern it already uses for the other five steps — the cleaner fix, since it keeps
  `research_worker.py` free of defensive code that exists only to accommodate one
  test's incomplete fake, and matches this session's established practice of fixing a
  trivial, unambiguous cross-file test consequence directly (same category as PR #63's
  and PR #69/#70's own fixes).

## What this unit does not do

No TradingAgents integration, no LLM call — `bull_case`/`bear_case`/`synthesis`/`risks`/
`model_version`/`prompt_version` are always `null` from this code; that is explicitly
the next, separate unit. No automatic retry of a `failed` job. No frontend. Does not
touch `GET /research/filings/{symbol}` (PR #69) or the job intake routes (PR #70).
