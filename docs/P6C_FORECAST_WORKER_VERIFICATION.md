# Bounded forecast worker verification

Third unit of roadmap Phase 6 (Experimental Forecast Lab) — the bounded worker that
drains the job queue PR #77 built intake for, mirroring PR #71's own research-worker
shape. Design written first as `docs/P6C_FORECAST_WORKER_CONTRACT.md`.

## Implemented by Grok, independently verified by me

- `app/models/forecast_result.py`: new model, `ForecastResult`.
- `alembic/versions/<new>_add_forecast_results.py`: new migration, chained onto
  head `d8e1b4c7a902`.
- `app/core/config.py`: one new setting, `scheduled_forecast_job_limit`.
- `app/services/forecast_worker.py`: new file, `process_pending_forecast_jobs` and
  its helpers.
- `app/services/scheduled_jobs.py`: one new (eighth) step wired into
  `_run_scheduled_steps`, same shape as the existing seven.
- `app/schemas/forecast_result.py`: new file.
- `app/routers/forecasts.py`: two new routes (`GET /forecasts`, `GET
  /forecasts/{forecast_id}`) added alongside the existing job routes, all
  untouched.
- `tests/test_forecast_worker.py`: new file.

## Independent verification

- Reviewed the full diff of every touched/new file directly (not Grok's self-report).
- Confirmed `process_one_job` raises its own `RuntimeError` (not a silent skip) when
  `settings.forecast_kronos_enabled` is `False`, and that this lands in the exact
  same `except`/`"failed"` path as any other failure — a test asserts the job's
  `error_message` is specifically `"Kronos forecasting is disabled
  (forecast_kronos_enabled is false)."`, not a generic or masked message.
- Confirmed `process_pending_forecast_jobs(db, max_jobs)` never processes more than
  `max_jobs` jobs in one call even when more are queued — a test seeds more queued
  jobs than the limit and asserts the excess stay `queued`.
- Confirmed every argument passed to `generate_forecast` is read from the stored
  job row unchanged (`symbol`/`provider`/`adjustment_type`/`lookback`/`horizon`/
  `sample_count`) — a test asserts the mocked `generate_forecast` was called with
  exactly those values, not re-derived or defaulted.
- Confirmed `tests/test_phase2_controls.py::test_scheduled_cycle_refreshes_before_writing_controls`
  (extended twice already, for `research` and `briefs`) still passes after a third
  extension for the new `forecasts` step.
- Confirmed the ownership-scoped result lookups match every other resource in this
  router.
- `python -m pytest -q tests/test_forecast_worker.py tests/test_phase2_controls.py
  tests/test_audit_fixes.py`: **37 passed** (9 new in `test_forecast_worker.py`, all
  of `test_phase2_controls.py`/`test_audit_fixes.py` unchanged and passing after the
  third extension of the shared scheduler-mock test).
- `python -m pytest -q` (full backend suite, fresh `--basetemp`): **488 passed, 28
  skipped, 0 errors** — up from the PR #77 baseline (479 passed) by exactly the 9
  new tests.
- `python -m alembic heads`: exactly one head (`f2c8e5a1d734`, chained onto
  `d8e1b4c7a902`); grepped the repo for the previous head string before shipping
  and bumped the two Postgres-only "fresh install reaches head" assertions
  pre-emptively.
- Confirmed `GET /forecasts/999999` (a numeric path that could theoretically
  collide with `/forecasts/jobs` if route registration order were wrong) correctly
  resolves to the parameterized `{forecast_id}` route and returns `404`, not a
  routing error — proven directly by a test, not just by code inspection.

## What this unit does not do

No chart UI, no walk-forward historical validation (roadmap 6.3, a separate much
larger unit). No `GET /forecasts/models` or `GET /forecasts/evaluations`. No
frontend. Does not touch `app/services/forecast_kronos.py`'s own implementation,
the job intake routes (PR #77), or any existing route.
