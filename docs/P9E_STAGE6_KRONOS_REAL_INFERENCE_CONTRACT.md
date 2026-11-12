# Current delivery sequence, Stage 6 — real Kronos inference, finally proven

Roadmap: [Sentinel_Markets_2_0_Roadmap.md, Stage 6](../Sentinel_Markets_2_0_Roadmap.md#6-kronos-forecasting),
step 2: "Prove one real inference call against real canonical bars before
anything else depends on it." Every prior unit touching Kronos this
session (`docs/P6A_KRONOS_WRAPPER_CONTRACT.md` through
`P6F_KRONOS_POINT_IN_TIME_VERIFICATION.md`) explicitly disclosed that
**nothing had ever actually been run against the real model** — torch
was never installed, the real weights were never downloaded. This unit
is the first time that actually happened.

## Why this wasn't a contract-first dispatch to Grok

This started as an attempt to install `requirements-forecast.txt` and
run `app/services/forecast_kronos.py`'s `generate_forecast` for real,
to see whether Stage 6 step 2 was actually reachable now that Docker
and other heavier resources had already proven workable earlier in this
session. It immediately surfaced two real, previously undiscovered
defects — not something to write a contract for in advance, since their
existence was unknown until encountered. Both are fixed below, each
confirmed by the error it produced and the real test re-run that
followed the fix.

## Defect 1: the vendored Kronos package's own import never worked

`app/vendor/kronos/kronos.py` line 10: `from model.module import *`.
This assumes a top-level `model` package — the original upstream Kronos
repository's own layout, where `kronos.py` and `model/` are siblings at
the repo root. Vendored under `app/vendor/kronos/`, this import has
never been able to resolve: `ModuleNotFoundError: No module named 'model'`,
confirmed as the exact, first failure encountered. Fixed with a one-line
change to a relative import: `from .module import *` (the actual
co-located file is `app/vendor/kronos/module.py`). No other change to
either file.

## Defect 2: `x_timestamp`/`y_timestamp` were never real datetime series

`app/services/forecast_kronos.py`'s `generate_forecast` built
`x_timestamp = pd.Series([date.fromisoformat(...) for bar in window])`
and `y_timestamp = pd.Series(future_sessions)` — both plain Python
`date` objects wrapped in a `pd.Series`, which pandas stores as
`dtype=object`, not `datetime64`. The vendored `kronos.py`'s own
`calc_time_stamps` calls `x_timestamp.dt.minute`, which requires a real
datetime64 Series and raises
`AttributeError: Can only use .dt accessor with datetimelike values`
otherwise — confirmed as the exact, second failure encountered, only
after Defect 1 was fixed and a real call actually reached this code
path for the first time. Fixed by wrapping both constructions in
`pd.to_datetime(...)`. The existing test file's own `_as_dates` helper
(`tests/test_forecast_kronos.py`) already handled real `datetime`
values via an `isinstance(item, datetime)` branch before this fix — it
was written anticipating the correct behavior, so this fix required no
test changes to the assertions themselves.

**Neither defect was ever caught by the existing test suite**, because
every existing test mocks `_load_predictor`/`read_symbol_history`
entirely (a `FakePredictor`) — the real `calc_time_stamps` code path
inside the vendored package was never actually executed by any prior
test. This is exactly why Stage 6 names "prove one real inference call"
as its own explicit, separate gate, rather than trusting mocked tests
alone.

## A third, real finding: raw model output has no OHLC-ordering guarantee

Running the real model against a synthetic (never real-market)
random-walk input series, 1 of 10 real forecast bars had `open > high` —
the raw Kronos output is a generative sampler with no hard constraint
keeping `open`/`close` inside `[low, high]`. This is a genuine model
characteristic, not a bug in the glue code. **Not fixed in this unit** —
if raw Kronos output is ever persisted into a table with OHLC
`CheckConstraint`s (like `MarketBarDaily`), it needs its own
clamping/validation layer first. Flagged as a real, open follow-up for
whenever Stage 6's later steps (real evaluation, publishing reviewed
forecasts) are attempted — not attempted here.

## New: a proof script, not a pytest test

`app/scripts/prove_real_kronos_inference.py` — follows
`app/scripts/validate_forecast_kronos.py`'s own established pattern
("Tests and CI do not run this script"). Seeds an in-memory SQLite
database with a synthetic random-walk daily series and calls
`generate_forecast` for real, downloading the real pinned weights on
first run (`NeoQuasar/Kronos-small`, `NeoQuasar/Kronos-Tokenizer-base`).
Reports, rather than asserts, the OHLC-ordering finding above. Not
added to the default pytest suite — it requires the heavy optional
dependencies this project has consistently kept out of default
CI/local runs.

## Fix to a test exposed by this unit's own install

`tests/test_forecast_kronos.py::test_missing_dependencies_raises_a_clear_runtime_error`
relied on the venv genuinely not having torch/pandas/kronos installed —
true for every prior test run this session, no longer true once this
unit installed them to actually prove real inference. Fixed to
monkeypatch `_import_kronos` directly (simulating the exact
`RuntimeError` the real function raises on a genuine import failure)
rather than depending on ambient environment state — robust either way,
going forward.
