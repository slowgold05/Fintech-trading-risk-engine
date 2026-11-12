# Current delivery sequence, Stage 3 first slice — Massive ingestion, verification

Contract: [P9B_STAGE3_MASSIVE_INGESTION_CONTRACT.md](P9B_STAGE3_MASSIVE_INGESTION_CONTRACT.md).

## Diff scope

Three new files only: `app/services/massive_client.py`,
`app/services/massive_ingestion.py`, `tests/test_massive_ingestion.py`.
Confirmed via `git status` that none of the five files the contract
marked read-only (`market_providers.py`, `market_quality.py`,
`exchange_calendar.py`, `market_history.py`, `market_cache_service.py`)
were touched.

## Logic review

- `http_get_massive` builds the exact documented grouped-daily URL,
  URL-encodes the API key, and raises `ProviderUnavailable` on both a
  non-2xx status and a `requests` exception — matches the contract.
- `ingest_one_day` correctly recognized a subtlety the contract didn't
  fully spell out: `check_bars`'s jump detection only compares bars
  passed into the *same* call, so to detect a price jump against
  already-stored canonical history, the previous session's bar has to
  be loaded from the database and passed in alongside the new day's
  bars. `_latest_prior_bars` does exactly this (one query per call,
  picking the most recent prior session per symbol). This is a correct,
  necessary addition beyond the contract's literal text, not a
  deviation from its intent.
- `_fails_table_checks` mirrors `MarketBarDaily`'s own `CheckConstraint`s
  exactly (price bounds, OHLC ordering, non-negative volume) — a bar
  that would violate a real database constraint is caught and recorded
  in `rejected` before any write attempt, rather than letting a failed
  flush abort the whole session. Confirmed by reading both the model's
  constraints and this function side by side.
- `_upsert_daily_bar` follows the exact check-then-create-or-update
  pattern specified (matching `market_cache_service.py`'s
  `_write_quote_cache`), keyed on the real composite primary key.
  `fetched_at` is written as `datetime.now(timezone.utc)` — genuinely
  timezone-aware, correctly *not* copying `Bar`'s own naive convention
  or `MarketQuoteCache`'s naive convention, exactly as the corrected
  contract specified.
- `backfill_two_years` uses `two_calendar_years_before` (imported from
  `market_history.py`, not reimplemented) combined with
  `expected_session_dates`, confirmed to produce 400+ real NYSE
  sessions for a 2-year window in the test.
- One self-reported, confirmed-accurate correction: the contract's own
  text claimed `grc/vendors/massive.md` states a "roughly 5 calls/minute"
  free-tier limit; checked that file directly — it does not state a
  specific number (that number came from this session's earlier
  `WebSearch` result, not from the vendor file itself). The shipped
  code's comment uses accurate wording instead of repeating the
  contract's own inaccurate attribution. Good catch, not a deviation
  worth blocking on.

## Test verification

Independently reran (not trusting the self-report alone), fresh
`--basetemp` each time, `AUDIT_DATABASE_URL` unset:

- `tests/test_massive_ingestion.py`: **5 passed** in 0.54s.
- Full backend suite, first run: `1 failed, 542 passed, 39 skipped` —
  the one failure, `tests/test_market_history.py::test_clock_sample_does_not_observe_a_quote_committed_during_the_sample`,
  is in a file this unit never touched. Isolated rerun: passed. Full
  suite rerun with a fresh `--basetemp`: **543 passed, 39 skipped, zero
  failures** — confirms the same pre-existing Windows-timing-sensitive
  flake already documented elsewhere in this project, not a regression
  from this unit.

## What this does not do

Does not run against the real Massive API — no key is configured in
this environment, and every test uses a mocked `http_get`. Does not
wire `backfill_two_years` into the scheduler or any route. Does not
build LSE (Stage 3 step 2) — deferred until LSEG's actual access path
and response shape are known, per the contract's own scope boundary.
Does not add real rate-limit pacing for a live backfill run — noted in
the code's own docstring as a prerequisite before ever pointing this at
a real key.
