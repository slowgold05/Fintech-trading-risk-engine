# Phase 7.3 — operational monitoring, first slice: `GET /compliance/ops-health`

Roadmap 7.3's last bullet: "operational monitoring for data freshness, job
age, retries, and AI cost." [V2_BACKLOG.md](V2_BACKLOG.md) already flags
this as "a real feature, not a quick audit step" since this app has no
observability stack today. This contract scopes the smallest honest first
slice of it — a single new read-only endpoint over data this app already
has — rather than building a dashboard, alerting, or new metrics storage.

## What exists already (reused, not rebuilt)

- `app/services/market_cache_service.py`'s `_freshness(quote, tier, now)`
  already classifies each symbol's cached quote as `"live-ish"`, `"delayed"`,
  `"cached"`, or `"stale"`, and the heatmap service already aggregates this
  into a `status_counts` dict for all active, non-test symbols. This
  endpoint reuses that function and that aggregation logic exactly — it
  does not invent a new freshness definition.
- `ResearchJob`/`ForecastJob` (`app/models/research_job.py`,
  `forecast_job.py`) both have a `status` column constrained to
  `queued|running|completed|failed|cancelled`, and `created_at`/`updated_at`
  timestamps. `app/services/research_worker.py`/`forecast_worker.py` set
  `status = "running"` then `"completed"` or `"failed"`.

## What this endpoint adds

New route `GET /compliance/ops-health` in `app/routers/compliance.py`,
gated by the existing `get_current_compliance_user` dependency (same
`compliance_officer`/`admin`/`auditor` roles already used by every other
route in that router — no new auth pattern). No request body/params.

Response shape:

```json
{
  "generated_at": "2026-11-09T12:00:00Z",
  "market_data_freshness": {
    "live-ish": 12,
    "delayed": 340,
    "cached": 8,
    "stale": 2
  },
  "job_queues": {
    "research": {
      "queued_count": 1,
      "running_count": 0,
      "oldest_queued_age_seconds": 45,
      "failed_last_24h_count": 0
    },
    "forecast": {
      "queued_count": 0,
      "running_count": 1,
      "oldest_queued_age_seconds": null,
      "failed_last_24h_count": 2
    }
  }
}
```

- `market_data_freshness`: call the existing `_freshness` logic across all
  active, non-test `MarketSymbol` rows joined to `MarketQuoteCache` (same
  symbol population the heatmap service already selects — reuse that
  query, don't write a second one), bucket-counted exactly like
  `status_counts` already does.
- `job_queues.research`/`.forecast`: for each of `ResearchJob`/`ForecastJob`,
  compute `queued_count` (`status == "queued"`), `running_count`
  (`status == "running"`), `oldest_queued_age_seconds` (seconds between now
  and the oldest `created_at` among `status == "queued"` rows, or `null` if
  none are queued), and `failed_last_24h_count` (`status == "failed"` and
  `updated_at >= now - 24h`).

## What this explicitly does not include, and why

- **Retries**: neither `ResearchJob` nor `ForecastJob` has a retry-count
  column, and neither worker re-enqueues a failed job — a job either
  completes or lands in `failed` once. There is nothing to report. Adding
  retry tracking would mean designing and shipping a retry mechanism itself
  (a new worker behavior, not a monitoring read), which is out of scope for
  a monitoring endpoint. This gap is reported here rather than fabricating
  a `retries: 0` field that implies tracking exists.
- **AI cost**: no code path in `research_llm.py`, `research_tradingagents.py`,
  or anywhere else captures token counts or dollar cost for any LLM call
  today. Reporting it would require instrumenting every LLM call site to
  capture and persist usage data first — a distinct, larger unit, not a
  monitoring read over existing data. Not attempted here; flagged as the
  next piece of this same roadmap bullet if picked up again.
- No new metrics storage, no polling loop, no alerting, no dashboard UI.
  This is one synchronous read-only endpoint computed from existing tables
  at request time, nothing persisted or scheduled.

## Test plan

New test file `tests/test_p73_ops_health.py`:

1. Non-compliance role (e.g. a plain trader) gets `403` from
   `/compliance/ops-health`.
2. Seed one `MarketSymbol` + stale `MarketQuoteCache` row (old `quote_at`)
   and assert it lands in the `"stale"` bucket of `market_data_freshness`.
3. Seed one queued `ResearchJob` with a `created_at` set a known number of
   seconds in the past; assert `job_queues.research.queued_count == 1` and
   `oldest_queued_age_seconds` matches within a small tolerance.
4. Seed one `ForecastJob` with `status="failed"` and `updated_at` within
   the last 24h; assert it's counted. Seed a second failed one with
   `updated_at` older than 24h; assert it's excluded.
5. Empty-state case: no queued jobs of a given type returns
   `oldest_queued_age_seconds: null`, not an error.

No application behavior outside the new route changes; no existing test's
expected behavior changes.
