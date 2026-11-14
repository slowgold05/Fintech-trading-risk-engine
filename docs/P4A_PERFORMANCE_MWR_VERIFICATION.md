# Money-weighted return verification

Adds `money_weighted_return_pct` to the top level of `GET /portfolio/performance`'s response
(a sibling of `status`, not a field inside `series`) — a single Modified Dietz figure for the
whole requested window. Sixth slice on the performance route (#37-42). Design written first as
contract section 14, with an independently fraction-verified reference continuing the same
10-day deposit/withdrawal scenario every prior slice uses.

## Implemented by Grok, independently verified by me

`_money_weighted_return_pct(flows, base_date, base_value, last_available_date, last_value)`,
called once after the main per-day loop ends (so it reads the loop's *final* `base_date`/
`base_value`/`last_available_date`/`last_value`, not per-iteration values), added as a
top-level sibling field, not inside any series point — exactly the contract's scope. Returns
`None` on two distinct guards, kept separate and each independently tested: `base_date ==
last_available_date` (fewer than 2 available days, `T` would be 0) and zero flows in
`[base_date, last_available_date]` inclusive (the roadmap's "where cash-flow history permits"
gate). Correctly noticed that `_flow_since` excludes its own `after` date but this calculation
must not — a flow dated exactly on `base_date` is invested for the whole period (weight 1) —
and wrote a distinct inclusive scan rather than reusing `_flow_since` with the wrong boundary.
Used `Decimal` throughout (no floats), reused `DRAWDOWN_UNIT` for the 4-decimal quantization
rather than inventing a duplicate constant.

Two new tests directly distinguish the two null causes instead of only asserting one of them:
`test_money_weighted_return_is_null_on_a_single_available_day` uses a genuinely single-trading-
day window with an intraday deposit already in the books (account value `"1100.00"`, not
`"1000.00"`) specifically to prove the single-day guard fires even when a flow *did* happen —
ruling out the possibility that the null came from the wrong guard. The existing six-day,
zero-flow scenario gets the opposite proof: at least two available days, `null` only because no
flow exists.

Independent verification: re-derived the reference with exact `Fraction` arithmetic before
review — `75 / (13220/13) = 195/2644 ≈ 0.0737518910...`, `* 100` quantized to 4 places is
`"7.3752"` — matched Grok's test exactly. `git status`/`git diff` confirmed only the 2 scoped
files changed; `docs/P4A_PERFORMANCE_CONTRACT.md`'s diff is my own pre-implementation section
14 addition (75 insertions), untouched by Grok. Confirmed `_cash_flows` already returns flows
sorted by date, so the new function's early `break` once `flow_date > last_available_date` is
safe.

- `python -m pytest -q tests/test_portfolio_performance.py`: **12 passed** (11 existing + 1 new).
- `python -m pytest -q` (full backend suite): **348 passed, 28 skipped**, 2 pre-existing
  unrelated Windows-local SQLite-locking errors documented since PR #27.
- No file outside `app/services/performance_service.py` and `tests/test_portfolio_performance.py`
  was touched.

## What changed

- `app/services/performance_service.py`: `_money_weighted_return_pct` added; called once after
  the main loop; result added as a top-level response field.
- `tests/test_portfolio_performance.py`: the reference 10-day flow scenario asserts
  `"7.3752"`; the zero-flow six-day scenario asserts `null`; one new dedicated single-day test.
- `docs/P4A_PERFORMANCE_CONTRACT.md`: new section 14, written by me before implementation,
  untouched by Grok.

## What this unit does not do

Does not add a per-day money-weighted figure, an annualized return, or a money-weighted
"since inception" figure spanning resets. Does not change any existing field's meaning. No
frontend rendering. No merge or deploy is claimed.
