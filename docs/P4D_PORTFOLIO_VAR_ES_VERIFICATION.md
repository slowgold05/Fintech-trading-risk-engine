# Historical VaR and Expected Shortfall (risk-metrics third slice) verification

Adds `historical_var_95_pct`, `historical_var_99_pct`, `expected_shortfall_95_pct`, and
`expected_shortfall_99_pct` to the existing `GET /portfolio/risk-metrics` response (PRs #47,
#48) — additive only, per `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 3, written
before implementation. Reuses the same period-over-period `twr_index` returns section 1's
volatility already computes (not the benchmark-paired returns section 2 added for beta). Six of
the roadmap's nine Phase 4.2 metrics are now closed across PRs #45/#47/#48/this one
(concentration, historical volatility, max drawdown, beta, historical VaR, Expected Shortfall);
correlation, risk contribution, and stress-test loss remain open, unstarted.

## Implemented by Grok, independently verified by me

Still a pure consumer of `_volatility_from_twr`'s own output — `_historical_var_and_es` takes
exactly the `returns: list[Decimal]` that helper already computed and returned (previously
unused by the caller beyond its length), so no `twr_index` ratio is computed a third time in
this module. `performance_service.py`, `portfolio_allocation.py`, and `app/routers/portfolio.py`
are all byte-identical to before this change.

- Nearest-rank method: sort ascending, `rank = ceil((1 - confidence) * return_count)` clamped
  to at least 1, VaR is the single value at that rank negated to a positive loss percentage, ES
  is the mean of the worst `rank` values negated the same way. A genuine, better-than-asked-for
  implementation choice: Grok computed `rank` with an exact `Decimal.to_integral_value(rounding
  =ROUND_CEILING)` rather than the `float`-based `math.ceil` my own task description suggested —
  avoiding any float-precision risk in the ceiling computation, strictly more correct than what
  I asked for.
- Both documented thresholds enforced exactly as specified: `return_count < 20` nulls all four
  fields; `20 <= return_count < 100` publishes only the 95% pair; `return_count >= 100`
  publishes all four. `test_var_and_es_are_null_below_twenty_returns` and
  `test_var_99_is_null_below_one_hundred_returns` each exercise one threshold independently of
  the other, and independently of volatility's own (lower) two-return threshold.
- The reference test also asserts `expected_shortfall_<c>_pct >= historical_var_<c>_pct` at
  both confidence levels from the live computed response, not just the hardcoded digits — a
  genuine property check (Expected Shortfall must never read below its own VaR, by construction
  of "mean of the tail including the VaR point").

## Independent verification

- Re-derived the contract's 121-value `twr_index` reference in a separate script before review
  (not trusting Grok's test fixture to be correct, even though it was transcribed from the same
  literal the task file gave it): 120 returns → `rank(0.95) = 6` → `historical_var_95_pct =
  "2.2300"`, `expected_shortfall_95_pct = "2.3300"`; `rank(0.99) = 2` →
  `historical_var_99_pct = "2.3872"`, `expected_shortfall_99_pct = "2.4333"`. Matched exactly.
- Reviewed the full diff of both touched files directly (not Grok's self-report).
- `python -m pytest -q tests/test_portfolio_risk.py`: **11 passed** (8 pre-existing + 3 new).
- `python -m pytest -q` (full backend suite): **379 passed, 28 skipped**, the same 2
  pre-existing unrelated Windows-local SQLite-locking errors (documented since PR #27).
- Confirmed `app/services/performance_service.py`, `app/services/portfolio_allocation.py`, and
  `app/routers/portfolio.py` are byte-identical to before this change.

## What changed

- `app/services/portfolio_risk.py`: new `_historical_var_and_es` helper;
  `build_risk_metrics_response` gains four new keys (additive — every existing key unchanged).
- `tests/test_portfolio_risk.py`: 3 new tests, plus the existing end-to-end integration test
  extended to assert the four new fields' shape.
- `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md`: section 3, written by me before
  implementation, untouched by Grok.

## What this unit does not do

Does not add correlation, risk contribution, or stress-test loss (each a separate, larger
future unit). Does not use a parametric or Monte Carlo VaR method — nearest-rank empirical
quantile only, a deliberate, documented policy choice. Does not scale VaR/ES by portfolio dollar
value (percentages only). Does not add `GET /portfolio/attribution`. No frontend rendering. No
merge or deploy is claimed.
