# Kronos forecast model wrapper contract

First unit of roadmap Phase 6 (Experimental Forecast Lab). Builds the model wrapper
only — no job queue, no API route, no chart UI. Those are separate, later units
(6.B-E), mirroring how Phase 5 decomposed into filings → jobs → worker → routes →
frontend. This unit's scope ends at: "given a symbol's cached canonical daily bars,
produce a bounded Kronos forecast, with honest governance paperwork disclosing
exactly what has and hasn't been validated."

## What was actually inspected before writing this contract

[Kronos](https://github.com/shiyu-coder/Kronos) (MIT, `shiyu-coder/Kronos`, pinned
commit `67b630e67f6a18c9e9be918d9b4337c960db1e9a`, 2026-04-13) is **not** a
pip-installable package — no `setup.py`/`pyproject.toml` exists in the repo. Its
`model/` directory (three files: `__init__.py`, `kronos.py`, `module.py`, no
dependency outside that directory) is meant to be used by adding it to the Python
path after cloning. Model weights are not vendored — they are downloaded at runtime
from the Hugging Face Hub via `from_pretrained` (model sizes: Kronos-mini 4.1M params,
Kronos-small 24.7M, Kronos-base 102.3M, Kronos-large 499M but not open-sourced). This
unit vendors the three source files directly (MIT permits this; the license text is
retained verbatim in a `NOTICE` file alongside them) rather than fighting `pip` into
installing an unpackaged repo.

## Governance: this app already has a model-inventory process — follow it, don't
invent a new one

`app/services/forecast.py` (pre-existing, not touched by this unit) is a deliberately
honest historical-volatility placeholder, explicit that "Kronos weights are not
downloaded and the Kronos path cannot feed a risk rule." Its own validation script,
`app/scripts/validate_forecast.py`, writes a model card and validation report under
`grc/models/` and merges an `SM-FC-01` row into `grc/models/inventory.yaml` via
`app.services.model_inventory.merge_models` — explicitly marked `"Approval: Pending
model owner review"`, `"Approved uses: None."` This unit's Kronos integration is a
**second, distinct** model entry, `SM-FC-02`, following the exact same honesty
discipline: it exists in code and is validated for *shape* (the integration wires
correctly end to end), but makes **no accuracy claim** and is marked unapproved,
pending model-owner review, pending the actual walk-forward evaluation roadmap section
6.3 calls for (a separate, larger unit — real historical backtesting with baseline
comparisons, not built here).

`merge_models` is additive (it merges by `id`, preserving every other writer's rows,
per its own docstring) — this unit must call it, never overwrite `inventory.yaml`
directly.

## Vendoring: `app/vendor/kronos/`

Copy exactly `__init__.py`, `kronos.py`, `module.py` from commit
`67b630e67f6a18c9e9be918d9b4337c960db1e9a`, byte-for-byte, into `app/vendor/kronos/`.
Add `app/vendor/kronos/NOTICE.md`: the pinned commit SHA, the source URL, and the MIT
license text verbatim (copyright "ShiYu", 2025). Do not modify the vendored files —
if a project-specific adjustment is ever needed, it belongs in the wrapper service
calling them, not in the vendored copies.

## New optional dependency file: `requirements-forecast.txt` (new, separate from
`requirements.txt`, mirroring PR #74's `requirements-research.txt` pattern)

```
pandas==2.2.2
numpy>=1.26,<2
torch>=2.2,<2.6
einops==0.8.1
huggingface_hub==0.33.1
safetensors==0.6.2
```

`pandas`/`numpy` are genuinely new to this app — `requirements.txt` has neither today
(this codebase does its financial math in `Decimal`, not pandas). **Not added to
`requirements.txt`** — same "invisible by default" principle as every optional heavy
dependency this session has added (CI's default install must never pull in `torch`).

## New vendor-register entry: `grc/vendors/huggingface.md` (new) + one new row in
`docs/vendors.md`'s table

Mirror the existing `grc/vendors/sec.md`/`alpaca.md` shape: what's called (the Hugging
Face Hub, to download the pinned `NeoQuasar/Kronos-*` model and tokenizer weights,
cached locally under `forecast_kronos_cache_dir`), what data is shared (none — no
account, order, or customer data; a model-name string only), criticality (none today,
since `forecast_kronos_enabled` defaults `False` — this app makes zero live calls to
Hugging Face unless an operator explicitly turns this on), and the same `"Approval:
Pending vendor-owner review"` closing line every other entry in this register uses.

## New settings: `app/core/config.py`, added directly below the existing
`research_tradingagents_data_dir` line

```python
forecast_kronos_enabled: bool = False
forecast_kronos_model_name: str = "NeoQuasar/Kronos-small"
forecast_kronos_tokenizer_name: str = "NeoQuasar/Kronos-Tokenizer-base"
forecast_kronos_cache_dir: str = "./var/kronos"
forecast_kronos_max_lookback: int = Field(default=400, ge=1, le=512)
forecast_kronos_max_horizon: int = Field(default=30, ge=1, le=120)
forecast_kronos_max_sample_count: int = Field(default=5, ge=1, le=20)
```

`max_lookback` caps at `512` — Kronos-small/base's own documented `max_context`; a
larger value is silently truncated by `KronosPredictor` per its own README, but this
app rejects it outright with a readable error instead (roadmap 6.1: "Reject
incompatible or insufficient inputs with a readable error" — don't rely on the
library's own silent-truncation fallback).

## New service: `app/services/forecast_kronos.py`

- `_import_kronos()`: lazy import (inside the function, never at module load) of
  `app.vendor.kronos.KronosTokenizer`, `app.vendor.kronos.Kronos`,
  `app.vendor.kronos.KronosPredictor`, and the external `torch` package. Raises a
  plain `RuntimeError` naming what's missing if any import fails — this module must
  stay importable (and every module that imports it must work) even when `torch`/
  `huggingface_hub` are not installed, exactly like PR #74's
  `research_tradingagents.py`.
- `_load_predictor()`: module-level cache (load once, reuse) —
  `KronosTokenizer.from_pretrained(settings.forecast_kronos_tokenizer_name,
  cache_dir=settings.forecast_kronos_cache_dir)`,
  `Kronos.from_pretrained(settings.forecast_kronos_model_name, cache_dir=...)`, then
  `KronosPredictor(model, tokenizer, max_context=512)`.
- `_next_trading_sessions(after: date, count: int) -> list[date]`: walks forward one
  calendar day at a time from `after`, keeping only days where
  `exchange_calendar.is_nyse_trading_day(day)` is true, until `count` sessions are
  collected. Future timestamps follow real trading sessions, not naive calendar days
  (roadmap 6.1's own explicit requirement) — reuses the existing, already-reviewed
  `exchange_calendar` module; does not duplicate or modify it.

**Reference vectors for `_next_trading_sessions`** (hand-verified independently
before implementation, by calling the real `exchange_calendar.is_nyse_trading_day`
directly — not a guess):
- `_next_trading_sessions(date(2026, 11, 6), 3)` → `[2026-11-09, 2026-11-10,
  2026-11-11]` (Friday → the following Mon/Tue/Wed; no holiday in this window).
- `_next_trading_sessions(date(2026, 11, 25), 3)` → `[2026-11-27, 2026-11-30,
  2026-12-01]` (Wednesday before Thanksgiving → Thursday the 26th is correctly
  skipped as the Thanksgiving holiday, landing on Friday the 27th, then the
  following Monday/Tuesday after the weekend).
- `generate_forecast(db, *, symbol, provider, adjustment_type, lookback, horizon,
  sample_count, seed=None) -> dict`:
  1. Validates `lookback <= settings.forecast_kronos_max_lookback`,
     `horizon <= settings.forecast_kronos_max_horizon`,
     `sample_count <= settings.forecast_kronos_max_sample_count` — `ValueError` with a
     readable message otherwise (the roadmap's own "reject incompatible or
     insufficient inputs" requirement).
  2. Calls the existing, already-reviewed
     `read_symbol_history(db, symbol=symbol, interval="1d", range_token="2y",
     provider=provider, adjustment_type=adjustment_type)` (from
     `market_history.py` — **this unit does not add a new data-reading path**, it
     reuses the one every chart in this app already reads from) and takes its
     `bars` list.
  3. `ValueError` ("insufficient history for the requested lookback") if fewer than
     `lookback` valid bars are available — this is the point-in-time guarantee: the
     forecast's input window is exactly the most recent `lookback` *already-cached,
     already-quality-filtered* sessions this app has for that symbol, never
     synthesized or backfilled for this call.
  4. Builds a `pandas.DataFrame` from the last `lookback` bars (parsing each
     decimal-text `open`/`high`/`low`/`close`/`volume` field to `float` — Kronos's own
     `predict` expects numeric columns, not the decimal-text convention this app uses
     everywhere else; this parsing step is the one place that convention is
     deliberately broken, and only for this external call).
  5. `x_timestamp` = each bar's `session_date`; `y_timestamp` =
     `_next_trading_sessions(last bar's date, horizon)`.
  6. Loads the predictor (`_load_predictor()`); if `seed` is given, calls
     `torch.manual_seed(seed)` immediately before predicting (confirmed by reading
     the vendored `kronos.py` directly: `KronosPredictor.predict`'s real signature is
     `predict(self, df, x_timestamp, y_timestamp, pred_len, T=1.0, top_k=0,
     top_p=0.9, sample_count=1, verbose=True)` — **there is no `seed` keyword
     argument on `predict` itself**; seeding is done by setting the global torch RNG
     state beforehand, not by passing a parameter through). Calls
     `predictor.predict(df=..., x_timestamp=..., y_timestamp=..., pred_len=horizon,
     sample_count=sample_count, verbose=False)` (note: `sample_count` *averages*
     multiple internal samples into one returned path — Kronos's own `predict` does
     not return several separate scenario paths per call; this unit returns that one
     averaged path, not an ensemble of paths. A later unit may expose multiple
     separately-sampled paths if the chart design calls for it — not built here).
  7. Returns:
     ```python
     {
         "symbol": symbol,
         "provider": provider,
         "adjustment_type": adjustment_type,
         "model_name": settings.forecast_kronos_model_name,
         "tokenizer_name": settings.forecast_kronos_tokenizer_name,
         "lookback": lookback,
         "horizon": horizon,
         "sample_count": sample_count,
         "input_cutoff": <last observed bar's session_date, ISO text>,
         "generated_at": <_iso_z of now>,
         "bars": [
             {"session_date": ..., "open": ..., "high": ..., "low": ..., "close": ..., "volume": ...},
             # one entry per predicted session, in order
         ],
     }
     ```
  Any exception from the model load or `predict()` call propagates — this function
  does not catch and does not decide what a failure means (the same contract every
  prior optional-backend function this session has used).

## Governance artifacts: `app/scripts/validate_forecast_kronos.py` (new, mirrors
`validate_forecast.py`'s own shape)

Writes `grc/models/cards/SM-FC-02.md` and `grc/models/reports/SM-FC-02.md`, and calls
`merge_models([...])` with an `SM-FC-02` row. **This script does not download real
weights and does not run real inference** — exactly like `validate_forecast.py`
itself never claims to validate SM-FC-01 against real market data. It instead:
monkeypatches/injects a small fake predictor (same shape `generate_forecast` expects)
to prove the integration's parameter-bounds checking, point-in-time bar selection, and
output shape are correct against a synthetic fixture — and the written report states
this limitation explicitly, in the same voice `SM-FC-01`'s own report already uses:

- Model card: purpose (bounded single-path forecast from cached daily bars), data
  (Hugging Face Hub, pinned revision, point-in-time cached bars — no live vendor call
  for price data), version, owner ("Market Risk, pending confirmation" — inherited
  from the `SM-FC` prefix's own established convention, not independently confirmed by
  this unit), limitations (**no walk-forward accuracy evaluation has been performed**;
  real model weights were not downloaded or exercised in this environment; this is
  shape/wiring validation only), approved uses (**none — pending model owner review**),
  prohibited uses (placing an order, changing a hard limit, treating this as validated
  forecasting accuracy, claiming walk-forward evaluation has occurred).
- Validation report: what was actually checked (bounds rejection, point-in-time bar
  windowing against a seeded fixture, output shape), explicitly **not** a hit-rate or
  accuracy number (there isn't one yet), `"Approval: Pending model owner review."`

## What this unit does not do

No job queue, no `/forecasts/*` API route, no chart UI toggle, no walk-forward
historical validation (roadmap 6.3 — a separate, much larger unit with its own
baseline-comparison methodology). No real Hugging Face download or real Kronos
inference was run as part of building or verifying this unit (disclosed boundary,
same category as PR #74's undone live `TradingAgentsGraph.propagate()` call). Does
not touch `app/services/forecast.py`, `SM-FC-01`, or any existing route.
