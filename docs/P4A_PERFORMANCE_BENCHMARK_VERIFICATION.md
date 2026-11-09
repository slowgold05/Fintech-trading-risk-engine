# SPY benchmark comparison verification

Adds `benchmark_index` to each point of `GET /portfolio/performance`'s daily series — a
time-weighted price-return index for a fixed benchmark symbol, `"SPY"`, chained the same way
`twr_index` is, but computed fully independently of the account's own availability or cash
flows. Fifth slice on the performance route (#37-40). Design written first as contract section
13, with an independently computed reference deliberately placing SPY's own data gaps on
different days than the account's own gaps, to prove the two chains never need to agree.

## Implemented by Grok, independently verified by me

Added `BENCHMARK_SYMBOL = "SPY"` (explicitly commented as fixed for this unit) and a new
`_benchmark_index_by_date(db, series_days)` helper: one query for the whole window (reusing
`_raw_closes`'s shape via a `{-1: "SPY"}` placeholder symbol map — `_raw_closes` only reads the
map's *values*, so the placeholder key is safe), grouped by date the same ambiguity-sensitive way
held-asset closes already are, walked once with its own independent `last_spy_value`/
`last_spy_index` locals that never touch the account's own `last_value`/`last_index`/
`last_available_date`. Returns a dict that only holds dates with a real index; the main loop
looks it up with `.get(session_day)` in both the `"unavailable"` and `"available"` branches, so
a SPY-available day can coincide with an account-gap day and vice versa. Used `TWR_UNIT`
(`Decimal("0.000001")`), not `CENT`/`DRAWDOWN_UNIT` — correct, since this is a chained ratio, not
a dollar amount.

Independent verification: re-derived the 10-day SPY chain in a separate script before review —
`1.000000/1.010000/1.020000/1.010000/1.030000/1.040000/1.050000/None/None/1.060000` — matched the
contract table and Grok's test exactly. `git status`/`git diff` confirmed only the 2 scoped files
changed plus my own untouched contract section 13 (72 insertions, identical before and after the
run). Read the new helper's query path by hand to confirm it is one call for the whole window
(not per-day) and that it never reads `missing`/`last_available_date` from the account's own
loop.

The new test, `test_spy_benchmark_index_is_independent_of_the_account_chain`, directly asserts
both independence claims the contract calls out: day 4 (an account gap) has a real
`benchmark_index` (`"1.030000"`); day 7 (a fully-valued account day) has `benchmark_index ==
null` because SPY itself has no close that day; day 9's index (`"1.060000"`) correctly chains
from day 6 across the two-day SPY-only gap rather than resetting. `test_query_count_does_not_grow_with_trading_days`
was correctly updated from asserting exactly 1 `market_bars_daily` statement to exactly 2 (held
asset + SPY), with a SPY bar seeded in that test's own fixture so the new query path is actually
exercised, and the existing "same statement count regardless of 1y vs 2y window" invariant
re-asserted with the new query included.

- `python -m pytest -q tests/test_portfolio_performance.py`: **11 passed** (10 existing + 1 new).
- `python -m pytest -q` (full backend suite): **346 passed, 28 skipped**, 2 pre-existing unrelated
  Windows-local SQLite-locking errors documented since PR #27.
- No file outside `app/services/performance_service.py` and `tests/test_portfolio_performance.py`
  was touched; `docs/P4A_PERFORMANCE_CONTRACT.md` diff is my own pre-implementation addition,
  untouched by Grok.

## What changed

- `app/services/performance_service.py`: `BENCHMARK_SYMBOL`, `_benchmark_index_by_date`, and
  `benchmark_index` added to both branches of the per-day series loop.
- `tests/test_portfolio_performance.py`: `benchmark_index` added to every existing series-point
  dict literal; one new test for the SPY chain; the query-count test updated for the new query.
- `docs/P4A_PERFORMANCE_CONTRACT.md`: new section 13, written by me before implementation,
  untouched by Grok.

## What this unit does not do

Does not add a configurable benchmark symbol (SPY is hardcoded), a relative-performance field
(e.g. `account_minus_benchmark`), or any frontend rendering. Does not change any existing field's
meaning. No merge or deploy is claimed.
