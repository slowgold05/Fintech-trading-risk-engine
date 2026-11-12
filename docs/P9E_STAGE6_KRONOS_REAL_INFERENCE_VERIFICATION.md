# Current delivery sequence, Stage 6 — real Kronos inference, verification

Contract: [P9E_STAGE6_KRONOS_REAL_INFERENCE_CONTRACT.md](P9E_STAGE6_KRONOS_REAL_INFERENCE_CONTRACT.md).

## Diff scope

`app/vendor/kronos/kronos.py` (one line), `app/services/forecast_kronos.py`
(two lines), `tests/test_forecast_kronos.py` (one test's monkeypatching),
new `app/scripts/prove_real_kronos_inference.py`. Nothing else.

## What was actually run, step by step

1. `pip install -r requirements-forecast.txt` into the project's
   temporary Python 3.11 venv: succeeded cleanly (`torch==2.5.1+cpu`,
   `pandas`, `numpy`, `einops`, `huggingface_hub`, `safetensors`).
2. First real attempt at `_load_predictor()`: failed with
   `ModuleNotFoundError: No module named 'model'` — Defect 1, diagnosed
   and fixed (one-line relative-import correction).
3. Second attempt: `_load_predictor()` succeeded, downloading the real
   pinned tokenizer and model from Hugging Face in **7.1 seconds**
   total (both are small: `Kronos-small` and `Kronos-Tokenizer-base`).
4. First real `generate_forecast` call against a synthetic seeded
   series: failed with
   `AttributeError: Can only use .dt accessor with datetimelike values`
   — Defect 2, diagnosed and fixed (`pd.to_datetime` wrapping).
5. Second `generate_forecast` call: **succeeded**, completing real
   inference in **2.2–2.3 seconds**, producing 10 real forecast bars
   with real `model_name`/`tokenizer_name`/`input_cutoff`/`generated_at`
   fields — the actual output is recorded in
   [P9E_STAGE6_KRONOS_REAL_INFERENCE_CONTRACT.md](P9E_STAGE6_KRONOS_REAL_INFERENCE_CONTRACT.md)'s
   own text and in this session's own record.
6. Observed 1 of 10 real forecast bars violate OHLC ordering —
   recorded as a genuine model-output finding, not asserted away.

This is the first real model inference ever run in this project's
history — every prior Kronos-touching unit disclosed explicitly that
this had never happened.

## Test verification

Independently reran (this review performed the fixes and the proof run
directly — there was no separate Grok dispatch for this unit, so "the
diff" and "the review" are the same hands; documented as such, not
presented as an independent second check):

- `app/scripts/prove_real_kronos_inference.py`: ran cleanly end to end,
  real weights downloaded once and cached, real inference completed in
  ~2.2s, OHLC finding reported (not asserted away) — reran once more to
  confirm reproducibility with the same `seed=42`: consistent result.
- `tests/test_forecast_kronos.py`: **12 passed** (previously 11 passed
  / 1 failed once torch was installed, before the monkeypatch fix).
- Full backend suite, with the heavy forecast dependencies now
  installed: **547 passed, 44 skipped, zero failures**, after
  confirming two separate occurrences of
  `tests/test_market_history.py::test_clock_sample_does_not_observe_a_quote_committed_during_the_sample`
  failing in the full run were the same pre-existing, already
  multiply-documented Windows real-time/WAL-timing flake (a
  file/test this unit never touched; passed cleanly both times in
  isolation). Plausibly more frequent right now specifically because
  of the sustained CPU/IO load from installing and running torch/model
  downloads concurrently on this machine — a load correlation, not a
  logic regression traced to any changed file.

## What this does not do

Does not run the walk-forward evaluation harness against the real
model (Stage 6 step 3) — a separate, larger unit. Does not fix the
OHLC-ordering gap in raw model output — flagged, not addressed. Does
not obtain model-owner review or publish anything to a user-visible
surface — Stage 6 steps 4–6 explicitly require that review first, and
nothing here attempts to skip it. Does not change
`FORECAST_KRONOS_ENABLED`'s default (still `false` everywhere,
including the hosted deployment) — real inference being *possible* is
not the same as it being *approved for use*.
