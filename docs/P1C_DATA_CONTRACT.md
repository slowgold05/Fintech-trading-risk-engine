# P1-C read-only data contract

Local groundwork on 2026-11-05, uncommitted. This is not full P1-C and it is not Phase 1 completion.

The written local decision is: synthetic fixture tests and cached canonical reads are allowed. Provider adapters and backfills stay disabled. No ingestion writer or job exists, and none should be added until the owner approves a provider for live history collection and public display. No exchange-session calendar has been reviewed.

`GET /market/data-status` and `GET /market/symbols/{symbol}/history` are an unblocked local foundation. A 200 from either route is not an entitlement, a coverage approval, or a statement that two years of sessions exist.

## Consistent read

Both routes, and the existing portfolio valuation wrapper, use `app/core/read_snapshot.py`.

- PostgreSQL: `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` as the first statement of the transaction. That isolation ends when the transaction ends. It is not stored on the pooled connection.
- SQLite: if the driver has not already begun a transaction, `BEGIN`. Legacy SQLite does not open a transaction for a bare `SELECT`.
- The session always rolls back on the way out, including on error.
- `PRAGMA query_only` is not used. It would remain on a pooled connection and break a later write.
- The read clock is one precise UTC instant fixed inside that transaction. A request timestamp taken outside the snapshot is not the clock, and there is no grace window.
- PostgreSQL reads `current_timestamp` in the open REPEATABLE READ transaction. That value keeps fractional seconds and is the transaction timestamp.
- SQLite `CURRENT_TIMESTAMP` is whole seconds. A timestamp stored earlier in the current second would compare as future. SQLite opens the WAL read view by reading one `sqlite_master` row (`SELECT name AS market_read_at FROM sqlite_master LIMIT 1`), then samples one Python UTC instant. A constant `SELECT 1` reads no database page and does not pin that view. Later reads stay on the view the schema row opened. An equal timestamp is eligible. A later fraction in the same second is still future.

Portfolio valuation uses this same clock, so its SQLite read view is opened before the Python sample. Position math, cash, reservations, quantization, and eligibility are unchanged. PostgreSQL isolation is unchanged.

These window and clock corrections are local source changes. The executed check is in the verification section below. It is not full P1-C or phase completion.

## `GET /market/data-status`

Public. No auth. No account, user, ledger, holding, deployment, Alembic revision, database identity, credential, or provider-key field.

`collection` is `disabled`. That value means canonical-history ingestion is off. It does not describe the existing quote refresh paths, and it is not a request option. The top-level `coverage_status` is `not_verified`. The top-level `expected_session_count` is null. Both stay that way on purpose: series spans differ, so there is no single aggregate. Per-series coverage is on each `canonical_history.series` entry.

### Populations

| Field | Who is counted |
| --- | --- |
| `universe.active_non_test_symbols` | Active, non-test symbols, including ETFs |
| `quote_census` | Active, non-test, non-ETF symbols, before any sector filter. This is the P0-A heatmap denominator, not the sector-filtered item list |
| `canonical_history` | Every stored `market_bars_daily` row, including rows for test or inactive symbols. Counts only; no symbol list |
| `legacy_price_history_daily.row_count` | Every stored legacy row. Not added to the canonical total and not used as bars |

The quote census is separate from canonical history, and canonical history is separate from legacy history. There is no default provider. Series stay split by `provider` and `adjustment_type`.

### Quote reconciliation

`eligible_symbol_count = cached_quote_rows + missing_cache_rows`.

`cached_quote_rows` is row presence, not freshness. `missing_cache_rows` is an eligible symbol with no cache row.

`cached_quote_rows = invalid_quote_rows + live-ish + delayed + cached + stale`.

An invalid quote has a non-finite or non-positive price, or a `quote_at` or `fetched_at` after the snapshot clock. Invalid rows stay out of the four freshness counts, so a bad price cannot look fresh.

A positive price with a null `quote_at` follows the existing `_freshness` rule and is `stale`, unless the fetch timestamp is in the future, in which case the row is invalid.

Freshness uses that same snapshot clock. Yahoo and Alpha Vantage keep the calendar-day rule (through 1 day `delayed`, through 7 days `cached`, otherwise `stale`). Any other source keeps the tier elapsed-time rule, including `live-ish` for a hot symbol inside the hot interval. The census calls `_freshness` while streaming. The policy is not copied into SQL, so the status route cannot drift from the heatmap rule. The cost is one projection scan of the non-ETF universe. The scan fetches 500 rows at a time, keeps counters only, and does not build a symbol cache. Identical empty quotes are not collapsed.

The statement count does not grow with the symbol count: one snapshot pin (the single `sqlite_master` row on SQLite, or `current_timestamp` on PostgreSQL), one universe count, three canonical reads (quality counts, stored span, and distinct session dates), one legacy count, and one census stream.

`status_counts` always has `live-ish`, `delayed`, `cached`, and `stale`.

### Canonical series

Each series reports `provider`, `adjustment_type`, `row_count`, `quality_counts` (`valid`, `flagged`, `rejected`), `symbol_count`, the stored session min/max, `coverage_status`, and `expected_session_count`. The stored span includes flagged and rejected rows. An unrecognized quality label fails the status read instead of being filed as valid.

Each series' `coverage_status` and `expected_session_count` use the same comparison as `GET /market/symbols/{symbol}/history`, against that series' own `stored_session_start`/`stored_session_end` and its own distinct stored `session_date` values. Those dates are not limited to `quality_status` `"valid"`. Flagged and rejected rows count, the same scope as the stored span. `coverage_status` is `"complete"`, `"gaps"`, `"unexpected_sessions"`, `"gaps_and_unexpected_sessions"`, or `"not_verified"` when the span is missing or outside the calendar's supported range. `expected_session_count` is the number of expected sessions in that span, or null when coverage is `"not_verified"`. A `"complete"` series matches the calendar across its own stored span. It is not a claim that two years of sessions exist.

The top-level `coverage_status` and `expected_session_count` remain `"not_verified"` and null unconditionally. Series can have different spans, so there is still no single aggregate value. That is deliberate, not an oversight.

No migration, grant, provider, or frontend change is part of this unit. The frontend type for `canonical_history.series` entries will be widened in a separate small follow-up.

`canonical_history.row_count` equals the sum of the quality counts and the sum of the series row counts. It does not include `legacy_price_history_daily.row_count`.

## `GET /market/symbols/{symbol}/history`

Public. No auth. Example: `/market/symbols/NVDA/history?interval=1d&range=2y&provider=fixture&adjustment_type=raw`.

Query rules, all required:

| Query | Accepted | Otherwise |
| --- | --- | --- |
| `interval` | `1d` only | 422 |
| `range` | `1y` or `2y` | 422 |
| `provider` | Nonempty, no leading or trailing space, at most 32 characters. Not trimmed into another name | 422 |
| `adjustment_type` | `raw` or `split_adjusted` | 422 |
| symbol path | Nonempty, no leading or trailing space, at most 20 characters | 422 |

A symbol that passes validation and is absent from `market_symbols` is 404. A known symbol with no eligible canonical rows is 200, `status: "unavailable"`, and `bars: []`.

The read never falls back to `price_history_daily` or `market_quote_cache`. It returns rows for the requested provider and adjustment only.

The window end is the snapshot date. For `range=1y` the window start is the same month and day one calendar year earlier. For `range=2y` it is the same month and day two calendar years earlier. 29 February moves back to 28 February when that earlier year has no 29 February. The response `range` field is the value that was requested and served (`1y` or `2y`). Before this unit the response always reported the literal `2y` after validation. The query itself includes only `session_date >= requested_start` and `session_date <= requested_end`. Rows outside that window are not transferred into the app and are not counted. There is no `outside_range_count`. Missing days inside the window are not filled.

`excluded_row_count` counts rows inside that window that are not returned:

- quality other than `valid`, including flagged and rejected
- missing `fetched_at`, or `fetched_at` strictly after the snapshot clock
- a session date that cannot be read

The primary key is one row per symbol, session, provider, and adjustment, so the read does not keep a duplicate-session set. Returned bars follow the query order, chronological by `session_date`. OHLC values are decimal strings quantized half-up to six places (`Numeric(18, 6)`), with no exponent. Volume is a nonnegative integer string, so zero is `"0"`. `fetched_at` is UTC with a `Z` suffix. Each bar repeats the provider and adjustment that were stored.

`available_start` and `available_end` are the first and last returned session, or null when there are no bars. `requested_start` and `requested_end` are the window. `status` is `unavailable` or `partial`. It is never `complete`. `coverage_status` is `not_verified`. `expected_session_count` is null. `collection` is `disabled` with the same meaning as on data-status: canonical-history ingestion is off, not quote refresh.

## Reviewed exchange calendar

`GET /market/symbols/{symbol}/history` now compares its returned sessions against a reviewed,
local NYSE trading-day calendar (`app/services/exchange_calendar.py`; see
[P1C_EXCHANGE_CALENDAR_VERIFICATION.md](P1C_EXCHANGE_CALENDAR_VERIFICATION.md)). `coverage_status`
is one of `"not_verified"`, `"complete"`, `"gaps"`, `"unexpected_sessions"`, or
`"gaps_and_unexpected_sessions"`, and `expected_session_count` is a real integer except when
`coverage_status` is `"not_verified"` (the requested window fell outside the calendar's
1990-2035 supported range, which does not happen for a normal today-minus-one-year or today-minus-two-years window).
The calendar models the standard annual NYSE holiday schedule only; it does not know about ad
hoc closures such as September 11, 2001, or weather/system outages, so a `"complete"` result is
a calendar-schedule comparison, not a claim of total historical accuracy.

`GET /market/data-status` still has no single window. Its top-level `coverage_status` stays
`"not_verified"` and its top-level `expected_session_count` stays null unconditionally. That is
deliberate: series can span different dates, and there is no one aggregate that would mean the
same thing for every series. Each `canonical_history.series` entry reports its own
`coverage_status` and `expected_session_count` for that series' stored span. See Canonical series
above. No migration, grant, provider, or frontend change is part of that per-series reporting.
The frontend type for those series entries will be widened in a separate small follow-up.

## What this unit does not do

No provider client, backfill, scheduler change, migration, or grant change. Restart-safe
ingestion and invalid-OHLC rejection at write time remain unmet P1-C acceptance items. Empty or
partial history stays an unavailable or partial payload, not a generated series.

## Verification, 2026-11-05

Codex reviewed this snapshot correction and ran the checks below. This records that pass only. It does not approve a provider, an exchange calendar, or live history ingestion, and it does not complete P1-C or a roadmap phase.

- Focused: `python -m pytest -q tests/test_market_history.py tests/test_portfolio_valuation.py --disable-warnings --tb=line`. 25 passed, 63 warnings, 5.06 seconds.
- Full backend on a fresh disposable local PostgreSQL 17.11 database, via the coordinator runner: 190 passed, 1 skipped, 606 warnings, 54.89 seconds. The skip is the opt-in browser module in the current Python environment. This pass added no browser journey.
- Mutation check, inside the test process only: replacing the schema-pin SQL with the original `SELECT 1` made both new WAL clock-sampling regressions fail with the original symptoms. Data-status reported cached 1 and invalid 1 instead of missing. Portfolio reported invalid instead of missing. The restored production helper passes. No source file was changed for that check.
- `git diff --check` passed. No hosted call, provider call, migration, deployment, or commit was part of this correction.
