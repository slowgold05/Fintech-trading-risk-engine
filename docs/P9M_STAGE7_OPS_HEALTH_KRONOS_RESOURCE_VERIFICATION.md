# Stage 7 follow-up — Kronos weight-cache size added to GET /compliance/ops-health

Closes the remaining half of Stage 7 step 2 flagged as open in
[P9J_STAGE7_OPS_HEALTH_MASSIVE_VERIFICATION.md](P9J_STAGE7_OPS_HEALTH_MASSIVE_VERIFICATION.md):
"resource-consumption monitoring for the new... forecast workers." There
is no live scheduled Kronos worker process to sample CPU or memory from
(`FORECAST_KRONOS_ENABLED` is still `false` everywhere). The honest,
measurable proxy available without a live worker is the on-disk size of
the Kronos model weight cache directory (`settings.forecast_kronos_cache_dir`,
default `./var/kronos` — where `_load_predictor` downloads real weights
to, per `app/services/forecast_kronos.py`, and which `.gitignore`'s
`var/` entry exists specifically because of).

## What changed

`app/routers/compliance.py` gains `_kronos_worker_health()` and a new
`"kronos_worker"` key in `GET /compliance/ops-health`'s response:

```json
{
  "weights_cache_dir_exists": false,
  "weights_cache_bytes": 0
}
```

`weights_cache_dir_exists` is `false` and `weights_cache_bytes` is `0`
when the cache directory doesn't exist yet (the honest state on any
machine that has never run real Kronos inference); otherwise
`weights_cache_bytes` is the real total size, in bytes, of every file
under that directory.

Dispatched to Grok against a precise, scoped spec (two files only, exact
helper code given). The diff matches the spec exactly. One correction
Grok made unprompted: the spec's test instructions implied importing
`Path` into the test file, which Grok caught was unnecessary and
unused (`tmp_path` fixture values are already `Path` objects) — it
left that import out rather than adding dead code.

## Verification

- Grok's own test run was blocked by the same headless permission wall
  seen in prior units — test execution and the full-suite rerun were
  done independently here.
- `git diff --stat` confirmed only the two intended files changed.
- `tests/test_p73_ops_health.py` alone: both new tests **errored**, not
  failed, on this machine — traced immediately to the same pre-existing
  Windows `pytest-of-sbhav` temp-directory permission issue already
  documented in `docs/P9G_STAGE7_MASSIVE_OUTAGE_RESILIENCE_VERIFICATION.md`.
  Confirmed by checking: every other test file already erroring on this
  machine (`test_job_admission.py`, `test_research_tradingagents.py`,
  `test_watchlists.py`) also uses the `tmp_path` fixture, and these two
  new tests are the first in `test_p73_ops_health.py` to use it — this
  is the same local-only quirk, not new test logic, and the two new
  tests are logically sound (confirmed by reading them against the
  helper's exact arithmetic: 100 + 50 = 150 bytes).
- Full backend suite: **549 passed, 44 skipped, 8 errors** (6
  pre-existing + these same 2, all `tmp_path`-related).
- PR #109's own GitHub Actions `backend` job (Linux) passed clean with
  these same two new tests included, confirming this is a Windows-local
  environment quirk, not something that affects real CI, and consistent
  with every prior PR this session where the same 6 pre-existing errors
  never reproduced on GitHub Actions either.

## What this does not do

Does not measure live CPU or memory — no scheduled worker process
exists to sample. Does not change `massive_ingestion`, `market_data_freshness`,
`job_queues`, or `ai_usage`.
