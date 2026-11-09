# Walk-forward forecast evaluation verification

Fifth unit of roadmap Phase 6 (Experimental Forecast Lab) — section 6.3's
walk-forward evaluation methodology: rolling windows, point-in-time correctness, a
documented baseline comparison, per-window error reporting, disclosed sample
sizes. Design written first as `docs/P6E_FORECAST_EVALUATION_CONTRACT.md`, with
four reference numbers (model/baseline MAE and directional accuracy on a
hand-built fixture) independently derived in a standalone script before writing
the contract.

## Implemented by Grok, independently verified by me

- `app/services/forecast_evaluation.py`: new file — pure methodology, no Kronos
  or DB dependency, fully unit-testable.
- `app/models/forecast_evaluation.py`: new model, `ForecastEvaluation` — no
  `user_id` column (a model-governance artifact, not a per-user resource).
- `alembic/versions/<new>_add_forecast_evaluations.py`: new migration.
- `app/scripts/run_forecast_evaluation.py`: new offline script — not CI-invoked,
  mirrors `validate_forecast_kronos.py`'s "writes rows directly" shape.
- `app/schemas/forecast_evaluation.py`: new file.
- `app/routers/forecasts.py`: two new, unauthenticated-by-ownership (but still
  auth-required) read-only routes — `GET /forecasts/evaluations`, `GET
  /forecasts/evaluations/{evaluation_id}` — no `user_id` filter on either, by
  design.
- `tests/test_forecast_evaluation.py`: new file.

## Independent verification

- Re-derived all four reference numbers (`1.3333`, `0.6667`, `2.0`, `0.3333`) in a
  standalone script before review, using the exact fixture in the contract. All
  four matched exactly.
- Confirmed `_directional_accuracy` always compares each day's predicted move
  against the **real** previous actual close, never the model's own prior
  prediction — a test with a deliberately wrong first-day call proves a single
  miss does not compound into every later day's score.
- Confirmed `evaluate_walk_forward_window`'s forecaster call only ever receives
  `history_bars[:cutoff_index]` — a test asserts the exact slice passed, proving
  no look-ahead.
- Confirmed `run_walk_forward_evaluation`'s selected windows never overlap in
  their "actual future" bars — a test with a short fixture and a window count
  that would require overlap raises `ValueError` instead of silently reusing
  data.
- Confirmed `GET /forecasts/evaluations` has no `user_id` filter — a test creates
  an evaluation row and confirms it is visible to every authenticated user, not
  just one.
- Confirmed `app/services/forecast_evaluation.py` has no top-level or any import
  of `app.services.forecast_kronos`, `torch`, or any vendored model code — the
  Kronos-specific adapter lives only in the offline script, never in the
  reusable, always-testable methodology module.
- `python -m pytest -q tests/test_forecast_evaluation.py`: **10 passed** (all new).
- `python -m pytest -q` (full backend suite, fresh `--basetemp`): **501 passed, 28
  skipped, 0 errors** — up from the PR #79 baseline (491 passed) by exactly the 10
  new tests.
- `python -m alembic heads`: exactly one head (`c5a9e2d8b417`, chained onto
  `f2c8e5a1d734`); grepped the repo for the previous head string before shipping
  and bumped the two Postgres-only "fresh install reaches head" assertions
  pre-emptively.
- **A genuine extra finding, caught by Grok, not by me**: `app/scripts/run_forecast_evaluation.py`'s
  own docstring correctly identifies that `generate_forecast` (PR #76) always
  reads the *latest* cached history via `read_symbol_history`, not a
  point-in-time historical cutoff — so wiring it directly into this evaluation
  harness's per-window `forecaster` callback would leak future data into every
  historical window's prediction. The script deliberately leaves the adapter as
  a documented `NotImplementedError` rather than silently building a
  look-ahead-contaminated evaluation. Confirmed this reasoning is correct by
  re-reading `generate_forecast`'s own implementation.
- Tried running the offline script for real (`python app/scripts/run_forecast_evaluation.py
  --symbol AAPL`) as a bonus sanity check beyond what was required; it hung on
  connecting to a real database (no reachable Postgres in this environment, the
  same boundary every `alembic upgrade head` attempt this session has hit) —
  stopped it rather than force a real DB connection. Not a blocking concern: the
  test suite already exercises `run_walk_forward_evaluation`'s `NotImplementedError`
  path and the DB-query shape independently.

## What was not verified (disclosed boundary)

Did **not** run `app/scripts/run_forecast_evaluation.py` against real Kronos
weights or real market history — same disclosed boundary as every other
Kronos-touching unit this session. Every test exercises the harness with a mock
forecaster, proving the methodology's correctness, not any claim about Kronos's
actual forecasting accuracy.

## What this unit does not do

No `POST` route to trigger an evaluation on demand (deliberately
offline/administrative). No flexible arbitrary-date-range historical data API
(the offline script queries `MarketBarDaily` directly instead). No chart UI. No
frontend. Does not touch any existing route, job, or worker.
