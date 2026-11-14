# Daily dollar P&L verification

This unit adds `daily_pnl` to each point of `GET /portfolio/performance`'s daily series — the
dollar change in `account_value` from the last available day, excluding the same deposit/
withdrawal flow `twr_index` already excludes. A third slice on the already-shipped performance
route (#37, drawdown #38). No new query, no new data source — reuses the exact `flow`/
`last_value` locals the TWR calculation already computes in the same loop. Design written first,
as a new contract section — [P4A_PERFORMANCE_CONTRACT.md](P4A_PERFORMANCE_CONTRACT.md) section
11 — with an independently computed reference continuing the same scenario sections 5/8/10
already test against.

## Implemented by Grok, independently verified by me

Scoped to exactly 2 files via per-file `--allow` rules (the contract doc was marked read-only
and left untouched). Grok's implementation:
- Computed `daily_pnl` inside the existing `else` branch (the one that already computes `flow`
  and `index` for `twr_index`), using those exact same locals — and crucially placed before
  `last_value = account` reassigns it, so `last_value` in the formula still refers to the
  *previous* available day's value at computation time, not the day being computed. Read this
  ordering carefully myself since getting it backwards would have silently produced `0.00` on
  every day.
- Correctly distinguished `None` (the first available day, no prior day to diff — or a gap) from
  `"0.00"` (a real, measured flat day), per the contract's explicit "null means unknown, zero
  means a real zero" convention.
- Implemented the contract's required cross-check exactly as specified: a loop asserting
  `daily_pnl == "0.00"` if and only if `twr_index` is unchanged from the prior available day,
  across the four flow-bearing/trade-driven reference days, with a useful failure-message tuple
  — not two independent assertions that merely happen to use consistent numbers, but an explicit
  logical equivalence check.
- Updated every existing series-point dict literal across the whole test file with the new key,
  the same completeness sweep the drawdown unit's task already established as the pattern here.

Independent verification I did myself:
- `git status` confirmed only the 2 scoped files changed, plus my own untouched contract
  addition.
- Independently computed the full daily-P&L reference table (continuing the same 10-day scenario)
  in a separate Python/Decimal script before writing the task — all seven values
  (`"20.00"`/`"20.00"`/`"10.00"`/`"25.00"` for the trade/price-driven days, `"0.00"` for every
  flow-only day) matched Grok's test file exactly.
- Re-ran `tests/test_portfolio_performance.py`: **10 passed** (same 10 test functions — this
  unit only extended existing tests' assertions, added no new test function).
- Re-ran the full backend suite: **345 passed, 28 skipped** (same count as the prior unit, for
  the same reason), same 2 pre-existing unrelated Windows-local SQLite-locking errors documented
  since PR #27.
- Read the diff's computation ordering by hand to confirm `last_value`/`flow` are read before
  being superseded for the next iteration, and that the gap/first-day `None` cases can never
  silently produce `"0.00"` instead.

## What changed

- `app/services/performance_service.py`: `daily_pnl` computed in the existing per-day loop,
  reusing `flow`/`last_value`, added to both the `"available"` and `"unavailable"` branches.
- `tests/test_portfolio_performance.py`: `daily_pnl` added to every existing series-point
  assertion; the contract's required cross-check assertion added to the deposit/withdrawal test.
- `docs/P4A_PERFORMANCE_CONTRACT.md`: new section 11, written by me before implementation,
  untouched by Grok.

## Verification run, 2026-11-07

- `python -m pytest -q tests/test_portfolio_performance.py`: **10 passed**, 0 failed.
- `python -m pytest -q` (full backend suite): **345 passed, 28 skipped**, 2 pre-existing
  unrelated errors (documented above).
- No file outside `app/services/performance_service.py` and
  `tests/test_portfolio_performance.py` was touched.

Does not add a top-level cumulative-P&L-since-inception summary field (needs a separate,
inception-anchored running total, a later addendum if wanted) or any frontend rendering. No
merge or deploy is claimed.
