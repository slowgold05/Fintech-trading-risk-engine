# Stage 7 follow-up — Massive backfill survives a one-day provider outage

Stage 7's own exit gate calls for testing provider outages "extending the
disposable-Postgres proofs already done... to the new Massive... code
paths." Reviewing `app/services/massive_ingestion.py::backfill_two_years`
found a real, previously-undiscovered gap: the function called
`ingest_one_day` back-to-back inside a loop with no `try/except`. A single
`ProviderUnavailable` from one bad day (a Massive outage, rate limit, or
malformed response) would propagate straight up and abort the entire
two-year, 400+ session backfill — losing every day already written and
every byte of the coverage report for the run.

## The fix

`backfill_two_years` now wraps the per-day `ingest_one_day` call in a
`try/except ProviderUnavailable`. On failure it records that session as
fully missing (every requested symbol added to that day's gaps, zero rows
written, zero rejected) with a new `"error"` field holding the exception
message, then continues to the next day. `ingest_one_day` itself is
unchanged — this only affects how its caller handles a day it could not
fetch at all.

`_coverage`'s returned dict gains one new field, `sessions_failed` (count
of per-day reports carrying an `"error"` key), alongside the existing
`sessions_attempted`/`sessions_with_data`/`symbols_fully_covered`/
`symbols_with_gaps`/`per_day`.

## What this does not do

Does not add retry or backoff for the failed day — a day that fails is
recorded as a gap, not retried within the same run. Does not change
pacing — `backfill_two_years`'s own docstring already discloses that rate
limiting is not built in this slice; that remains true. Does not touch
`ingest_one_day`'s per-symbol handling (the `missing`/`rejected` logic for
a day that *did* fetch) — only the case where the fetch itself raised.

## Verification

- New test, `test_backfill_two_years_survives_a_provider_outage_on_one_day`:
  a fake `http_get` raises `ProviderUnavailable` for exactly one day in the
  middle of a real ~2-year session list, returns valid data for every other
  day. Confirms: all sessions still attempted (no early abort), exactly one
  `sessions_failed`, the outage day's symbol(s) appear in
  `symbols_with_gaps`, the failed day's own report carries the exact error
  string, and no row for that day was written to the database while every
  other day's row was.
- `tests/test_massive_ingestion.py`: **6 passed** (5 existing + this one).
- Full backend suite: **543 passed, 44 skipped**, plus 6 pre-existing
  errors in unrelated files (`test_job_admission.py`,
  `test_research_tradingagents.py`, `test_watchlists.py`) traced to a
  Windows temp-directory permission error
  (`PermissionError: [WinError 5] Access is denied:
  '...\\Temp\\pytest-of-sbhav'`) when pytest's own tmp-path cleanup runs —
  confirmed unrelated to this change by isolating one of those tests and
  reproducing the identical error with this branch's changes absent.
