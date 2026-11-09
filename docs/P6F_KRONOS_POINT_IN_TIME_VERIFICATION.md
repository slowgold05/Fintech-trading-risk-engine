# Phase 6 follow-up — Kronos point-in-time fix, verification

Contract: [P6F_KRONOS_POINT_IN_TIME_CONTRACT.md](P6F_KRONOS_POINT_IN_TIME_CONTRACT.md).

## Diff scope

`app/services/forecast_kronos.py`, `app/scripts/run_forecast_evaluation.py`,
`tests/test_forecast_kronos.py` — exactly the three files granted. No
other file touched.

## A real bug caught and fixed before shipping

Grok's diff correctly implemented the `as_of` filter and the real
`_make_kronos_forecaster` closure, but left `main()`'s
`except NotImplementedError:` unchanged. That was correct for the old
stub (which deliberately raised `NotImplementedError`), but the new real
adapter calls `generate_forecast`, which raises **`RuntimeError`** (not
`NotImplementedError`) via `_import_kronos` when `torch`/the vendored
Kronos package aren't installed. Left as Grok wrote it, running this
script without the heavy optional dependencies installed would have
crashed with an unhandled `RuntimeError` traceback instead of the
designed friendly stderr message. Fixed by changing the `except` clause
to `RuntimeError` before this was ever run or shipped.

## Logic review

- `generate_forecast`'s new `as_of` parameter filters `bars` to
  `session_date <= as_of` before both the `insufficient history` guard
  and the `window = bars[-lookback:]` slice — confirmed by reading the
  diff directly. `None` (the default) preserves every existing caller's
  behavior unchanged, confirmed by a dedicated test
  (`test_generate_forecast_without_as_of_matches_the_full_history_window`)
  that asserts the `as_of=None` and omitted-argument cases produce
  byte-for-byte identical results.
- `_make_kronos_forecaster`'s closure correctly caps `lookback` at
  `min(len(bars), settings.forecast_kronos_max_lookback)` — this was the
  one subtlety flagged in the contract before dispatch (observed history
  grows with each walk-forward window and can exceed the configured max;
  passing it uncapped would make later windows fail the lookback guard
  for a reason unrelated to real data insufficiency).
- `_load_bars` now returns full OHLCV, matching what `generate_forecast`
  needs; `main()` wires `_make_kronos_forecaster(db, args.symbol,
  args.provider, args.adjustment_type)` in place of the old stub
  reference.

## Test verification

Independently reran, in the project's temporary Python 3.11 venv:

- `tests/test_forecast_kronos.py` with `pandas` not installed: 9 passed,
  3 skipped (the pandas-dependent tests — expected, consistent with the
  disclosed "heavy optional deps not installed in this venv" boundary).
- Installed `pandas` only (no `torch`, no Kronos weights — a lightweight
  dependency, not the heavy compute boundary) specifically to actually
  exercise the 3 previously-skipped tests rather than leave them
  unverified: **12/12 passed**, including the new point-in-time cutoff
  test and the insufficient-pre-cutoff-history rejection test.
- Full backend suite with `pandas` now installed: **515 passed, 28
  skipped, zero failures** — no regression anywhere else.

## What this does not do

Still does not install `torch`, the vendored Kronos weights, or exercise
a real model call — that remains a separate, later, heavier decision
(downloading multi-hundred-MB-to-GB weights and running real CPU
inference), not attempted in this unit. This unit closes the specific,
named blocker ("`generate_forecast`'s own 'always reads latest history'
limitation") that prevented wiring a real adapter at all — the adapter is
now correct and ready, pending that separate dependency-install decision.
