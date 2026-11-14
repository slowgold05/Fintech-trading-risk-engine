# Phase 7.3 — `GET /compliance/ops-health` verification

Contract: [P73_OPS_HEALTH_CONTRACT.md](P73_OPS_HEALTH_CONTRACT.md).

## Diff scope

Grok implemented this inside the exact two-file scope granted
(`app/routers/compliance.py`, `tests/test_p73_ops_health.py`). `git diff
--stat` confirms only those two files changed plus unrelated pre-existing
local modifications to `AGENTS.md`/`CLAUDE.md` that predate this session's
work and were not touched by this unit.

## Logic review

- The new route imports and calls `_freshness` directly from
  `app/services/market_cache_service.py` rather than reimplementing
  freshness classification — matches the contract's explicit "don't invent
  a new freshness definition" requirement. Confirmed by reading the diff:
  `from app.services.market_cache_service import _freshness`, called as
  `_freshness(quote, symbol.refresh_tier, now)` inside the same
  `MarketSymbol`/`MarketQuoteCache` join and `is_active`/`is_test`/`is_etf`
  filter the heatmap service already uses.
- `_job_queue_stats` computes all four fields per the contract: queued and
  running counts via `func.count()`, oldest queued age via `func.min(created_at)`
  compared against the request-time `now`, and `failed_last_24h_count` via
  a `status == "failed"` + `updated_at >= now - 24h` filter. Naive/aware
  datetime handling (`.replace(tzinfo=None)`) matches how the rest of this
  codebase stores `DateTime` columns without a timezone.
- No `retries` or AI-cost field was added — matches the contract's explicit
  exclusion.
- The route has no explicit per-route auth dependency because the router
  itself is declared with `dependencies=[Depends(get_current_compliance_user)]`
  — every other route in this file relies on the same router-level gate, so
  this is consistent with the existing file, not a new pattern.

## Test verification

Independently reran (not trusting Grok's self-report alone), in the
project's temporary Python 3.11 venv with `AUDIT_DATABASE_URL` unset and a
fresh `--basetemp` each time:

- `tests/test_p73_ops_health.py` alone: **5 passed**.
- Full backend suite, first run: `1 failed, 505 passed, 29 skipped` —
  the one failure, `tests/test_market_history.py::test_clock_sample_does_not_observe_a_quote_committed_during_the_sample`,
  is in a file this unit never touched. Re-ran that single test in
  isolation: passed. Re-ran the full suite a second time with yet another
  fresh `--basetemp`: **506 passed, 29 skipped, zero failures** — the same
  Windows pytest-timing-sensitivity pattern already documented elsewhere in
  this project, not a regression from this change. (This is the test's own
  name describing a clock-sampling race condition it is designed to guard
  against — exactly the kind of test most exposed to real scheduling
  jitter on a shared dev machine.)

Each of the 5 new tests maps to its "Test plan" case in the contract
one-to-one: 403 for a non-compliance role, stale-quote bucket count,
queued-job age with a 5-second tolerance, 24h failed-count boundary (1 hour
ago counted, 48 hours ago excluded), and the empty-queue `null` case.
