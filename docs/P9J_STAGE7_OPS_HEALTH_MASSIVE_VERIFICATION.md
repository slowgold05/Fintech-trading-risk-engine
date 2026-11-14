# Stage 7 follow-up — Massive ingestion monitoring added to GET /compliance/ops-health

Stage 7 step 2 calls for "freshness, job-age, error-rate, and
resource-consumption monitoring for the new data and forecast workers,
extending the existing `GET /compliance/ops-health` endpoint rather than
building a second monitoring surface." The endpoint already reported
quote freshness and research/forecast job-queue stats, but nothing about
the new Massive daily-bar ingestion path.

## What changed

`app/routers/compliance.py` gains one new helper, `_massive_ingestion_health`,
and one new top-level key in `GET /compliance/ops-health`'s response,
`"massive_ingestion"`:

```json
{
  "symbols_covered": 2,
  "latest_session_date": "2026-11-10",
  "flagged_last_30d_count": 0
}
```

- `symbols_covered`: distinct symbols with at least one `provider="massive"`
  row in `market_bars_daily`.
- `latest_session_date`: the most recent `session_date` across all
  `provider="massive"` rows, or `null` when there are none — the
  freshness signal for this pipeline.
- `flagged_last_30d_count`: count of `provider="massive"` rows with
  `quality_status="flagged"` whose `session_date` falls within the last
  30 days — the error-rate signal.

Dispatched to Grok against a precise, scoped spec (two files only:
`app/routers/compliance.py` and `tests/test_p73_ops_health.py`, exact
helper code given, exact response-key placement given). The diff matches
the spec exactly. One thing Grok caught correctly that the spec didn't
spell out: `MarketBarDaily.symbol` is a foreign key to `MarketSymbol`, so
its new tests seed a `MarketSymbol` row before any `MarketBarDaily` row —
matching this file's existing `_seed_symbol` helper.

## What this does not do

Does not add resource-consumption (CPU/memory/disk) monitoring for the
Kronos worker — that half of step 2 remains open; it would need an actual
running worker process to measure, which doesn't exist on a schedule yet
(`FORECAST_KRONOS_ENABLED` is still `false` everywhere). Does not change
`market_data_freshness`, `job_queues`, or `ai_usage` — only adds the new
key.

## Verification

- Grok's own test run was blocked by the same headless permission wall
  seen in prior units — test execution and the full-suite rerun were
  done independently here.
- `git diff --stat` confirmed only the two intended files changed.
- `tests/test_p73_ops_health.py`: **10 passed** (7 existing + 3 new).
- Full backend suite: **548 passed, 44 skipped**, same 6 pre-existing
  unrelated errors already documented. One additional transient failure
  seen on the first full-suite run,
  `tests/test_market_history.py::test_clock_sample_does_not_observe_a_quote_committed_during_the_sample`
  — this is the same pre-existing Windows timing-sensitive test flagged
  in earlier units this project; isolated (passed alone), then the full
  suite rerun clean a second time with zero failures, confirming it did
  not reproduce and is not a regression from this change.
