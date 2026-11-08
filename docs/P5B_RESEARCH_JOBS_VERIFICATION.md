# Research job intake verification

Second unit of roadmap Phase 5 (AI Research Desk) — the job-queue **intake** API named
in section 5.4 (`POST /research/jobs`, `GET /research/jobs/{job_id}`,
`POST /research/jobs/{job_id}/cancel`), plus `GET /research/jobs` for listing. No worker
exists yet; a job can only ever be `queued` or `cancelled` from this code. Design written
first as `docs/P5B_RESEARCH_JOBS_CONTRACT.md`.

## Implemented by Grok, independently verified by me

- `app/models/research_job.py`: new model, `ResearchJob`.
- `alembic/versions/<new>_add_research_jobs.py`: new migration, chained onto head
  `e1a7c3b5d820`.
- `app/schemas/research_job.py`: new file, `ResearchJobCreate`/`ResearchJobOut`/
  `ResearchJobCollection`.
- `app/routers/research.py`: four new routes added alongside PR #69's existing
  `GET /research/filings/{symbol}`, which is untouched.
- `tests/test_research_jobs.py`: new file.

This is pure ownership/state-machine logic, not financial arithmetic — unlike most prior
units, there is no Decimal reference vector to independently re-derive. Verification here
instead focuses on the ownership-isolation, state-transition, and cap-enforcement
behavior actually being correct.

## Independent verification

- Reviewed the full diff of every touched/new file directly (not Grok's self-report).
- Confirmed the ownership-scoped lookup for both `GET /research/jobs/{job_id}` and the
  cancel route filters `user_id` in the same query as `id` (one `WHERE`, mirroring
  `GET /orders/{order_id}`) — a job owned by a different user produces the identical
  `404` a nonexistent job produces, never a distinguishing `403`.
- Confirmed the cancel route locks the row (`with_for_update()`) before checking
  `status`, mirroring `order_book.cancel_order`'s own locking.
- Confirmed the 10-job cap counts both `queued` and `running` (forward-compatible with
  the not-yet-built worker, even though `running` is unreachable from this code).
- Confirmed the unknown/inactive-symbol rejection reuses the exact existing
  `"Unknown or inactive stock symbol"` wording `POST /watchlists/{id}/symbols` already
  uses, not a new message.
- `python -m pytest -q tests/test_research_jobs.py`: **9 passed** (all new).
- `python -m pytest -q` (full backend suite): **424 passed, 28 skipped** — up from the
  PR #69 baseline (415 passed) by exactly the 9 new tests; same 2 pre-existing unrelated
  Windows-local SQLite-locking errors (documented since PR #27).
- `python -m alembic heads`: exactly one head (the new revision, `c9e4a7b2d618`, chained
  onto `e1a7c3b5d820`).
- **Caught proactively this time** (PR #69 was caught by CI, not locally): grepped the
  whole repo for the previous head string before shipping and found the same two
  Postgres-only "fresh install reaches current head" assertions
  (`tests/test_audit_postgres.py`, `tests/browser/test_p0b_acceptance.py`) that needed
  bumping to the new head. `tests/test_watchlist_migrations.py`'s own additive-isolation
  proof — fixed in PR #69 to pin to the watchlist migration's own revision instead of
  "head" — needed no further change, confirming that fix actually solves the general
  problem rather than just the one instance.

## What this unit does not do

No worker, no TradingAgents integration — `status` never becomes `running`,
`completed`, or `failed` from this code; those three values exist in the
`CheckConstraint` now so the worker unit that comes next needs no further migration.
No `GET /research/reports`, `GET /research/reports/{report_id}`, `GET /research/briefs`,
or `GET /research/briefs/{brief_id}`. No frontend. Does not touch
`GET /research/filings/{symbol}` (PR #69) or any other existing route.
