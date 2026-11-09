# Forecast Lab — open limitations to resolve before real use

Everything in roadmap Phase 6 (PRs #76-#81) is built and tested, but **nothing has
ever been run against a real model**. This doc is the single place to come back to
before actually turning this feature on. Each item below is a real, specific
blocker — not a vague "needs more testing."

## 1. The optional dependencies are not installed anywhere

`torch`, `pandas`, `numpy`, `einops`, `huggingface_hub`, `safetensors` live in
`requirements-forecast.txt`, deliberately kept out of `requirements.txt` so CI and
the default install stay light. **To do anything real, first run:**

```
pip install -r requirements-forecast.txt
```

on whatever machine will actually run the worker (not necessarily this dev
environment — this is a real resource commitment: `torch` alone is a large
install, and local CPU inference on a `Kronos-small` model, while much lighter
than an LLM, is still real compute per call).

## 2. Real Hugging Face weights have never been downloaded

`app/services/forecast_kronos.py`'s `_load_predictor()` calls
`KronosTokenizer.from_pretrained(...)`/`Kronos.from_pretrained(...)`, which will
try to download `NeoQuasar/Kronos-small` and `NeoQuasar/Kronos-Tokenizer-base`
from the Hugging Face Hub on first real use, caching under
`forecast_kronos_cache_dir` (default `./var/kronos`). This needs outbound network
access to `huggingface.co` and disk space. Nobody has verified this download path
actually works end to end — it is only verified by reading the vendored source
and the official README, never exercised.

**Before enabling for real**, re-review
[grc/vendors/huggingface.md](grc/vendors/huggingface.md) — it is currently
"Pending vendor-owner review," written when this call was still hypothetical.

## 3. The feature flag is off, and flipping it on is a real decision

`settings.forecast_kronos_enabled` defaults to `False`. Turning it on (env var)
is the actual "go live" switch — once on, the scheduler's own forecast-worker
step (`scheduled_forecast_job_limit`, default `1` per cycle) will try to run a
real Kronos inference call on every queued job. The first real run should
probably be a manual, supervised test (create one job via `POST
/forecasts/jobs`, enable the flag, trigger the scheduled cycle or call
`process_pending_forecast_jobs` directly, watch what actually happens) before
leaving it on unattended.

## 4. The walk-forward evaluation harness cannot be wired to the real model yet
— this is a real bug waiting to be fixed, not just "not done"

`app/scripts/run_forecast_evaluation.py`'s `_kronos_forecaster` is a deliberate
`NotImplementedError` stub, **because wiring it naively would be wrong, not just
incomplete**: `generate_forecast` always reads the *latest* cached history via
`read_symbol_history` (there is no way to tell it "pretend today is some earlier
date and only show me bars up to then"). A walk-forward evaluation needs exactly
that point-in-time capability — without it, every historical window's "forecast"
would actually see bars from after its own cutoff, making the evaluation's
numbers meaningless (optimistically biased, since the model would be "cheating"
by seeing the real future).

**To actually fix this**, `generate_forecast` (or a new sibling function) needs
an optional `as_of` parameter that queries `MarketBarDaily` directly with an
explicit `session_date <= as_of` filter, instead of always going through
`read_symbol_history`'s `range_token`-relative-to-now window. That's a real,
scoped piece of backend work, not just "run the script."

Once that exists, `run_forecast_evaluation.py`'s adapter can be written for
real, and a real evaluation can finally be produced and read back via `GET
/forecasts/evaluations`.

## 5. No real evaluation exists — treat every forecast as unvalidated until one
does

`GET /forecasts/evaluations` will return an empty list until step 4 is fixed and
someone runs the script for real. The `SM-FC-02` model card
([grc/models/cards/SM-FC-02.md](grc/models/cards/SM-FC-02.md)) says this
explicitly: "Approved uses: None. Pending model owner review." Don't let a
forecast's presence in the UI be mistaken for a validated signal — nothing in
this app currently claims otherwise, and that should stay true until a real
walk-forward result exists and has actually been reviewed.

## Suggested order to pick this back up

1. Decide whether this is worth the real infra cost (disk, compute, a maintained
   `torch` install) before doing anything else.
2. Fix the point-in-time data gap (item 4) — this blocks evaluation regardless of
   whether inference ever runs for real, and is useful to have even before
   enabling live forecasting.
3. Install `requirements-forecast.txt` on a machine that can afford the compute,
   and do one fully manual, supervised test run of `generate_forecast` directly
   (not through the scheduler) to confirm the Hugging Face download and
   inference actually work.
4. Only then set `forecast_kronos_enabled = True` and let the scheduler pick up
   real jobs.
5. Run `run_forecast_evaluation.py` for real on at least one liquid symbol with
   deep history, read the result, and have a human (not just this session)
   decide whether the model's accuracy is good enough to move `SM-FC-02` past
   "pending review."

## Also still open, unrelated to Kronos specifically

PR #74 (TradingAgents, Phase 5) introduced outbound calls to Yahoo Finance/SEC
EDGAR/FRED through its own internal data-vendor layer, without a corresponding
`grc/vendors/` entry or `docs/vendors.md` row — a gap discovered while building
Phase 6's own Hugging Face vendor entry, tracked here as a reminder, not yet
fixed.
