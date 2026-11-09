# Forecast models listing verification

Fourth unit of roadmap Phase 6 (Experimental Forecast Lab) — `GET /forecasts/models`,
a small read-only route reporting the one configured Kronos model's current state.
Design written first as `docs/P6D_FORECAST_MODELS_CONTRACT.md`.

## Implemented by Grok, independently verified by me

- `app/schemas/forecast_model.py`: new file.
- `app/routers/forecasts.py`: one new route, existing routes untouched.
- `tests/test_forecast_models.py`: new file.

## Independent verification

- Reviewed the full diff directly (not Grok's self-report).
- Confirmed the `source_commit` value matches exactly the same literal string PR
  #76 vendored (`app/vendor/kronos/NOTICE.md`) and its own validation script already
  records — not a second, independently-typed copy.
- Confirmed the route reflects live settings (a test flips
  `settings.forecast_kronos_enabled` and asserts the response's `enabled` field
  changes accordingly — not a hardcoded value).
- `python -m pytest -q tests/test_forecast_models.py`: **3 passed** (all new).
- `python -m pytest -q` (full backend suite, fresh `--basetemp`): **491 passed, 28
  skipped, 0 errors** — up from the PR #78 baseline (488 passed) by exactly the 3
  new tests.
- No migration needed — confirmed no schema change (head unchanged from PR #78's
  own `f2c8e5a1d734`).

## What this unit does not do

No `GET /forecasts/evaluations` (deferred to the walk-forward validation unit,
roadmap 6.3, where it will actually have something to list). No chart UI. No
frontend. Does not touch any existing route, job, or worker.
