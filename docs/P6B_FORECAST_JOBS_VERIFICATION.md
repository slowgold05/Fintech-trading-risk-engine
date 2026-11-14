# Forecast job intake verification

Second unit of roadmap Phase 6 (Experimental Forecast Lab) — the job-queue intake
surface (`POST /forecasts/jobs`, `GET /forecasts/jobs`, `GET
/forecasts/jobs/{job_id}`, `POST /forecasts/jobs/{job_id}/cancel`). No worker exists
yet; a job can only ever be `queued` or `cancelled` from this code. Design written
first as `docs/P6B_FORECAST_JOBS_CONTRACT.md`.

## Implemented by Grok, independently verified by me

- `app/models/forecast_job.py`: new model, `ForecastJob`.
- `alembic/versions/<new>_add_forecast_jobs.py`: new migration, chained onto head
  `a9c3e7d1f504`.
- `app/schemas/forecast_job.py`: new file.
- `app/routers/forecasts.py`: new file, mounted at `/forecasts` in `app/main.py` —
  the first route under this prefix.
- `tests/test_forecast_jobs.py`: new file.

## Independent verification

- Reviewed the full diff of every touched/new file directly (not Grok's self-report).
- Confirmed the ownership-scoped lookup for both `GET /forecasts/jobs/{job_id}` and
  the cancel route filters `user_id` in the same query as `id` — a job owned by a
  different user produces the identical `404` a nonexistent job produces.
- Confirmed the cancel route locks the row before checking `status`, mirroring
  `order_book.cancel_order`'s own locking.
- Confirmed the 5-job cap (tighter than research jobs' 10) counts both `queued` and
  `running`.
- Confirmed `adjustment_type` is validated against the existing
  `market_history.SUPPORTED_ADJUSTMENTS` constant (not a duplicated/divergent list),
  and that `lookback`/`horizon`/`sample_count` are each checked against
  `settings.forecast_kronos_max_*` at intake, using the exact same bounds
  `generate_forecast` (PR #76) itself checks.
- Confirmed the unknown/inactive-symbol rejection reuses the exact existing
  `"Unknown or inactive stock symbol"` wording.
- `python -m pytest -q tests/test_forecast_jobs.py`: **13 passed** (all new).
- `python -m pytest -q` (full backend suite, fresh `--basetemp`): **479 passed, 28
  skipped, 0 errors** — up from the PR #76 baseline (466 passed) by exactly the 13
  new tests.
- `python -m alembic heads`: exactly one head (`d8e1b4c7a902`, chained onto
  `a9c3e7d1f504`); grepped the repo for the previous head string before shipping and
  bumped the two Postgres-only "fresh install reaches head" assertions
  pre-emptively.

## What this unit does not do

No worker, no real Kronos inference — `status` never becomes `running`,
`completed`, or `failed` from this code. No `GET /forecasts/{forecast_id}`, `GET
/forecasts/models`, or `GET /forecasts/evaluations`. No frontend. Does not touch any
existing route or `app/services/forecast_kronos.py`'s own implementation.
