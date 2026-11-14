# Portfolio beta (risk-metrics second slice) verification

Adds `portfolio_beta` and `beta_pair_count` to the existing `GET /portfolio/risk-metrics`
response (PR #47) — additive only, per `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 2,
written before implementation. Second metric closed on Phase 4.2's nine-metric table; seven
remain open (historical VaR, Expected Shortfall, correlation, risk contribution, stress-test
loss — concentration already closed by `GET /portfolio/allocation`; historical volatility and
max drawdown already closed by this same route's first slice).

## Implemented by Grok, independently verified by me

Still a pure consumer of one `build_performance_response` call — `performance_service.py`,
`portfolio_allocation.py`, and `app/routers/portfolio.py` are all byte-identical to before this
change (confirmed with `git diff --stat`, empty on all three; the route needed no change since
it already returns whatever `build_risk_metrics_response` returns).

- A day "pairs" only when the account's `status == "available"` **and** that same series
  entry's `benchmark_index` is non-null — computed as its own filter directly over
  `performance["series"]`, not derived from the existing `available` list (which does not
  filter on `benchmark_index` at all, since that field's own nullability is independent of the
  account's status, per `performance_service.py`'s own design).
- `_beta` follows `_volatility_from_twr`'s exact conventions: `localcontext(Context(prec=50))`,
  sample (`ddof=1`) covariance/variance, `FOUR_PLACES`/`ROUND_HALF_UP`/`format(x, "f")`. Two
  independent null gates, both exercised by tests: fewer than 2 return pairs, and a benchmark
  with zero variance across the paired returns (the division-by-zero guard the contract
  explicitly called for, even though real SPY data should never trigger it).
- A genuinely useful test I did not spell out in exact form: `test_beta_is_null_below_two_pairs`
  varies three different scenarios (0, 1, and 2 return pairs) while keeping `observed_periods`/
  `return_count` large enough that volatility stays non-null in all three — proving beta's null
  gate is independent of volatility's, not an accidental shared threshold.

## Independent verification

- Re-derived the contract's own reference vector in a separate script before review: paired
  `twr_index = [1.000000, 1.020000, 1.040000, 1.000000, 1.050000]`,
  `benchmark_index = [1.000000, 1.010000, 1.020000, 1.005000, 1.015000]` (one series day with a
  priced account but a null `benchmark_index` correctly excluded from the pairing) → sample
  covariance `0.00042120103459408850981938983297090496541526703676297`, sample variance
  `0.00015198485837817604292545915627560159988347915079349` → `portfolio_beta =
  "2.7713"`, `beta_pair_count = 4`. Matched exactly.
- Reviewed the full diff of both touched files directly (not Grok's self-report).
- `python -m pytest -q tests/test_portfolio_risk.py`: **8 passed** (5 pre-existing + 3 new).
- `python -m pytest -q` (full backend suite): **376 passed, 28 skipped**, the same 2
  pre-existing unrelated Windows-local SQLite-locking errors (documented since PR #27).
- Confirmed `app/services/performance_service.py`, `app/services/portfolio_allocation.py`, and
  `app/routers/portfolio.py` are byte-identical to before this change.

## What changed

- `app/services/portfolio_risk.py`: new `_beta` helper; `build_risk_metrics_response` gains
  `beta_pair_count`/`portfolio_beta` (additive — every existing key unchanged).
- `tests/test_portfolio_risk.py`: 3 new tests, plus a `"benchmark_index"` key added to every
  existing crafted series fixture (the real response always carries this key; the pre-existing
  tests' mocked fixtures needed it added to stay representative of the real shape).
- `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md`: section 2, written by me before
  implementation, untouched by Grok.

## What this unit does not do

Does not add historical VaR, Expected Shortfall, correlation, risk contribution, or stress-test
loss (each a separate, larger future unit). Does not annualize beta (unnecessary — covariance
and variance scale together over the same period length, so no annualization question arises
the way it does for volatility). Does not add `GET /portfolio/attribution`. No frontend
rendering. No merge or deploy is claimed.
