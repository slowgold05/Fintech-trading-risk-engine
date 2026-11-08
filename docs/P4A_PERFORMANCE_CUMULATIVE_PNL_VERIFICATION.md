# Cumulative dollar P&L verification

Adds `cumulative_pnl` to each point of `GET /portfolio/performance`'s daily series — total
dollar gain/loss since the series' base day, excluding deposits/withdrawals since then. Fourth
slice on the performance route (#37-39). No new query/data source — a second `_flow_since` call
anchored at `base_date` instead of `last_available_date`. Design written first as contract
section 12 with an independently computed reference.

## Implemented by Grok, independently verified by me

Correctly set `base_value`/`base_date` once, on the first available day, with `cumulative_pnl =
"0.00"` there (a real measured zero, not null). Every later available day computes a genuinely
*second* `_flow_since` call (distinct window from the one already computed for `daily_pnl`), not
a reuse of the wrong anchor. Added a real telescoping-sum test: `cumulative_pnl` on a given day
is asserted to equal the sum of every `daily_pnl` from the series' base day through that day
(skipping `null` gap-day entries), computed from the actual response data in the test, not a
second hardcoded number.

Independent verification: re-derived the reference table in a separate script beforehand (all
values — `"0.00"`/`"20.00"`/`"40.00"`/`"50.00"`/null/`"75.00"` for the first six days, `"75.00"`
flat through days 6/7/9 — matched exactly); `git status` confirmed only the 2 scoped files
changed; `tests/test_portfolio_performance.py`: 10 passed (no new test function, extended
assertions); full backend suite: 345 passed, 28 skipped, same 2 pre-existing unrelated errors
documented since PR #27.

Does not add a dedicated top-level summary field (the last series point's `cumulative_pnl`
already is that total). No merge or deploy claimed.
