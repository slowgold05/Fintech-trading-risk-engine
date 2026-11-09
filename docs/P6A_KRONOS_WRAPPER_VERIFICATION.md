# Kronos forecast model wrapper verification

First unit of roadmap Phase 6 (Experimental Forecast Lab) — the model wrapper only
(no job queue, no API route, no chart UI; those are separate later units, same
decomposition Phase 5 used). Design written first as
`docs/P6A_KRONOS_WRAPPER_CONTRACT.md`, after reading Kronos's own source
(`model/__init__.py`, its README's exact `KronosPredictor` usage) rather than
guessing, and after discovering this app's existing model-governance process
(`app/services/forecast.py`'s honest `SM-FC-01` placeholder, `grc/models/`, the
vendor register in `docs/vendors.md`/`grc/vendors/`) and following it rather than
inventing a parallel one.

## Implemented by Grok, independently verified by me

- `app/vendor/kronos/`: three vendored files (byte-identical to commit
  `67b630e67f6a18c9e9be918d9b4337c960db1e9a`) plus a `NOTICE.md`.
- `requirements-forecast.txt`: new file — **not** added to `requirements.txt`.
- `grc/vendors/huggingface.md` + one new row in `docs/vendors.md`.
- `app/core/config.py`: seven new settings.
- `app/services/forecast_kronos.py`: new file, lazy-imports the vendored package and
  `torch` only inside the functions that need them.
- `app/scripts/validate_forecast_kronos.py`: new file, writes `grc/models/cards/
  SM-FC-02.md` and `grc/models/reports/SM-FC-02.md`, merges an `SM-FC-02` row into
  `grc/models/inventory.yaml` via the existing `merge_models` (additive, not an
  overwrite).
- `tests/test_forecast_kronos.py`: new file — the real `torch`/vendored-model import
  is never exercised; every test monkeypatches the lazy-import point directly.

## Independent verification

- Confirmed `app/services/forecast_kronos.py` has no top-level `import torch` or
  vendored-model import anywhere — `python -c
  "import app.services.forecast_kronos"` succeeds in this environment, where `torch`
  is genuinely not installed.
- Re-derived both `_next_trading_sessions` reference vectors independently by calling
  the real `app.services.exchange_calendar.is_nyse_trading_day` directly in a
  standalone script before review (a Friday → Mon/Tue/Wed with no holiday in the
  window; a pre-Thanksgiving Wednesday → correctly skips the Thursday holiday,
  landing Friday, then the following Monday/Tuesday). Both matched the contract
  exactly.
- Confirmed `generate_forecast` reuses the existing, already-reviewed
  `read_symbol_history` for its input bars — no new or duplicate data-reading path
  was added.
- Confirmed the bounds checks (`lookback`/`horizon`/`sample_count` against their
  three configured maximums) raise before any model load is attempted, and that
  insufficient cached history raises its own distinct, readable error.
- Confirmed `requirements.txt` is byte-identical to before this change.
- Confirmed `merge_models` was called (not a direct rewrite of `inventory.yaml`) —
  `grc/models/inventory.yaml`'s pre-existing `SM-FC-01`, `SM-SV-*`, and `SM-AML-*`
  rows are all still present, byte-identical, after this unit's script runs.
- Confirmed `grc/models/cards/SM-FC-02.md` and the report explicitly state: no
  walk-forward accuracy evaluation has been performed, real weights were not
  downloaded or exercised, approved uses are none, and approval is pending model
  owner review — the same honesty discipline `SM-FC-01`'s own card already uses, not
  a weaker or more optimistic claim.
- `python -m pytest -q tests/test_forecast_kronos.py`: **9 passed** (all new).
- `python -m pytest -q` (full backend suite, fresh `--basetemp`): **466 passed, 28
  skipped, 0 errors** — up from the PR #74 baseline (457 passed) by exactly the 9 new
  tests. A first run without a fresh basetemp hit 5 transient Windows pytest-temp-dir
  `PermissionError`s (the same pre-existing environment issue already hit once during
  PR #74's own verification, unrelated to this unit's code); a fresh `--basetemp`
  cleared all five.
- `python app/scripts/validate_forecast_kronos.py`: exits `0`; all six guard checks
  (`lookback_over_max_rejected`, `horizon_over_max_rejected`,
  `sample_count_over_max_rejected`, `insufficient_history_rejected`,
  `reference_vectors_matched`, `output_shape_matched`) report `true`.
- `git diff --stat grc/models/inventory.yaml` after running the script: **18
  insertions, 0 deletions** — the `SM-FC-01`, every `SM-SV-*`, and every `SM-AML-*`
  row are all still present, byte-identical.
- **Found and fixed one real issue in Grok's own diff**: `generate_forecast` called
  the bare `import pandas as pd` directly (unguarded), while only `torch`/the
  vendored model were wrapped in `_import_kronos`'s `RuntimeError` guard. Since
  `pandas` happens to already be installed in this dev environment (unrelated to
  this project — its own `requirements.txt` has never listed it), this gap was
  silently masked in testing: every test passed despite the inconsistency, because
  `pandas` never actually failed to import here. Wrapped the `pandas` import in its
  own `try`/`except` raising the same clear `RuntimeError`, and added `pandas` to
  `_import_kronos`'s own guard too, without disturbing the test suite's mocking seam
  (an initial attempt to call the full `_import_kronos()` eagerly at the top of
  `generate_forecast` was reverted — it bypassed the `_load_predictor` mock
  `test_generate_forecast_builds_correct_input_window_and_future_sessions` relies on
  to avoid needing `torch` installed).

## What was not verified (disclosed boundary)

Did **not** install `requirements-forecast.txt` or download real Kronos weights from
Hugging Face Hub, and did **not** run a real `KronosPredictor.predict()` call — same
category of disclosed boundary as PR #74's undone live `TradingAgentsGraph.propagate()`
call. The vendored source files were read directly to confirm their exported API
(`KronosTokenizer`, `Kronos`, `KronosPredictor`, `from_pretrained`, `predict`
signature), but this unit's actual forecasting behavior against real weights was not
exercised — consistent with the governance artifacts' own explicit disclosure that no
accuracy evaluation has occurred.

## What this unit does not do

No job queue, no `/forecasts/*` route, no chart UI, no walk-forward historical
validation (roadmap 6.3, a separate much larger unit). Does not touch
`app/services/forecast.py`, `SM-FC-01`, or any existing route. Does not fix the
separately-discovered gap that PR #74 (TradingAgents) introduced outbound calls to
Yahoo/SEC EDGAR/FRED through its own internal data layer without a corresponding
vendor-register entry — that is tracked as its own small follow-up unit, not folded
into this one.
