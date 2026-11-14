# Performance by position/asset verification

Adds `realized_pnl` and `total_pnl` to each entry in `GET /portfolio/`'s `positions` list.
`realized_pnl` is the per-asset breakdown of the account-wide `summary.total_realized_pnl`
(same latest-reset inception boundary, grouped by asset instead of summed account-wide).
`total_pnl` is `realized_pnl + unrealized_pnl` when a price is available, `null` when it is
not. Design written first as `docs/P4B_POSITION_PERFORMANCE_CONTRACT.md`, with reference
numbers reused directly from the two already-shipped fixtures in
`tests/test_portfolio_valuation.py` plus a new, dedicated reset-boundary scenario.

## Implemented by Grok, independently verified by me

Refactored the existing `_realized_subquery`'s boundary logic (latest `reset` ledger entry,
trades posted after it) into a shared `_realized_sell_scope(user_id)` helper, reused by both
the unchanged account-wide subquery and a new `_realized_by_asset(db, user_id)` — one grouped
`GROUP BY Trade.asset_id` query, not one query per position. Added `Holding.asset_id` to the
existing single-statement snapshot query so each position row can look itself up in the new
dict. A never-sold asset is simply absent from the dict; the per-position loop does
`.get(asset_id, Decimal(0))`, so `realized_pnl` is always a real value, never null — matching
the contract's "never sold is a measured zero" rule.

For the reset-boundary test, Grok correctly recognized that the boundary subquery reads
`LedgerEntry` rows (`event_kind == "trade"`), not bare `Trade` rows, and called the real
`append_trade`/`append_reset` production helpers to build matching ledger entries for each
sell — a more faithful test than my task spec literally asked for (which only said "record a
Trade"), and the right call: a test that skipped `append_trade` would have passed for the wrong
reason (the boundary subquery would have seen zero trade-ledger rows at all, not a correctly
filtered set).

Independent verification: re-derived `AAPL total_pnl = 12.34 + 180.50 = 192.84` and
`MSFT total_pnl = 0.00 + -44.85 = -44.85` in a separate script beforehand; matched exactly.
`git status`/`git diff` confirmed only the 2 scoped files changed, and
`docs/P4B_POSITION_PERFORMANCE_CONTRACT.md` was left untouched (still untracked, exactly as I
wrote it). Read `append_trade`'s real signature and the boundary subquery by hand to confirm the
new reset test exercises the real production ledger path, not a shortcut.

- `python -m pytest -q tests/test_portfolio_valuation.py`: **12 passed** (11 existing + 1 new).
- `python -m pytest -q` (full backend suite): **347 passed, 28 skipped**, 2 pre-existing
  unrelated Windows-local SQLite-locking errors documented since PR #27.
- No file outside `app/services/portfolio_valuation.py` and `tests/test_portfolio_valuation.py`
  was touched.

## What changed

- `app/services/portfolio_valuation.py`: `_realized_sell_scope` extracted and shared;
  `_realized_by_asset` added; `Holding.asset_id` added to the snapshot query;
  `realized_pnl`/`total_pnl` added to the per-position loop.
- `tests/test_portfolio_valuation.py`: both existing fixtures extended with the new fields; one
  new test, `test_position_realized_pnl_reuses_the_reset_boundary`.
- `docs/P4B_POSITION_PERFORMANCE_CONTRACT.md`: new contract, written by me before
  implementation, untouched by Grok.

## What this unit does not do

Does not add performance-by-asset-type or sector-level aggregation (separate, later Phase 4.1
roadmap items). Does not change `summary.total_realized_pnl`'s existing account-wide meaning or
reconcile it against the sum of per-position `realized_pnl` (the summary is account-wide across
every asset ever traded; the per-position field only covers currently-held assets — not claimed
equal). No closed-positions list. No frontend rendering. No merge or deploy is claimed.
