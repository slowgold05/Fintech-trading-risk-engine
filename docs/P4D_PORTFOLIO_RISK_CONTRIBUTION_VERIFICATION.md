# Risk contribution (risk-metrics sixth, final slice) verification

Adds `risk_contributions` to the existing `GET /portfolio/risk-metrics` response (PRs #47-#51)
— additive only, per `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 6, written before
implementation. This is the roadmap's ninth and final Phase 4.2 metric — every metric on that
table now has some form shipped across PRs #45 (concentration) and #47-#51/this unit
(volatility, max drawdown, beta, historical VaR, Expected Shortfall, correlation, stress-test
loss, risk contribution).

## A real error I caught in my own contract before any code was written

My first draft of section 6.4's worked reference reused section 4.4's `var_a` — the variance
of `AAA`'s returns computed over the `AAA`∩`BBB` **pair-restricted** common-day window (5
returns, since `BBB`'s day 4 was ambiguous and excluded from that pair) — as if it were `AAA`'s
own diagonal variance. Per section 6.1's own text, the diagonal must be each security's **own**
full usable-day variance: `AAA` has no ambiguity of its own, so its true diagonal uses all 7 of
its own days (6 returns), a different, larger sample than the 5-return intersection.

Grok's first attempt at this task caught the discrepancy directly: it computed both the
pair-restricted and the security's-own-diagonal variance, found they disagreed, and **stopped
without writing any code**, reporting the exact numbers on both sides rather than guessing
which one I meant or silently picking one. I independently re-derived both figures in a
separate script, confirmed Grok's math, rewrote section 6.4 with the corrected reference
(`risk_contribution_pct` `"38.7968"`/`"61.2032"`, not the original wrong `"33.7947"`/
`"66.2053"`), and relaunched the task with the correction called out explicitly at the top. The
second attempt implemented cleanly against the corrected spec.

## Implemented by Grok, independently verified by me

`performance_service.py`, `portfolio_valuation.py`, `portfolio_allocation.py`, and
`app/routers/portfolio.py` are all byte-identical to before this change.

- `_pairwise_covariance` is a new, separate function from `_pairwise_correlation` (not a
  refactor of it) — both share the same common-days/return-count/`Context(prec=50)` shape, but
  `_pairwise_correlation`'s own existing behavior and tests are untouched.
- `_risk_contributions` builds the full covariance matrix (diagonal included) over the
  `held_symbols × held_symbols` product, correctly exploiting symmetry (`covariance[(a,b)] ==
  covariance[(b,a)]`, computed once and reused) rather than computing each off-diagonal pair
  twice. Returns `None` for the **entire** result the instant any single matrix entry — even
  one far from the pair actually missing data — cannot be computed, exactly the all-or-nothing
  rule the contract specifies.
- A genuinely useful refactor beyond what I asked for: `requested_start`/`requested_end` are
  now parsed from ISO text to `date` objects exactly once in `build_risk_metrics_response`, and
  passed as `date` objects into both `_held_correlations` (updated) and the new
  `_risk_contributions` — removing a small duplicate parse that existed before this unit.
- The Euler-decomposition sum-to-100% property is checked directly from the live computed
  response in three different tests (the reference test, and twice more inside the real
  DB-seeded end-to-end test), not just asserted as a hardcoded pair of numbers.

## Independent verification

- Re-derived the corrected contract reference in a separate script before accepting Grok's
  second attempt: `var(AAA)` over its own 6 returns `0.00028459142482739615947657075752608920
  826080589756838`, `var(BBB)` over its own 5 returns (coincidentally equal to section 4.4's
  `var_b`) `0.0013871936922561708854880149110690569535114319917560`, `covariance(AAA, BBB)`
  over their 5-return common window `0.00043524385357409836122616562497758373092408409098` →
  `portfolio_variance = 0.00053332095341441717247820735846968141837927960547598` →
  `risk_contribution_pct_AAA = "38.7968"`, `risk_contribution_pct_BBB = "61.2032"`. Matched
  Grok's implementation exactly.
- Reviewed the full diff of both touched files directly (not Grok's self-report).
- `python -m pytest -q tests/test_portfolio_risk.py`: **22 passed** (18 pre-existing + 4 new).
- `python -m pytest -q` (full backend suite): **390 passed, 28 skipped**, the same 2
  pre-existing unrelated Windows-local SQLite-locking errors (documented since PR #27).
- Confirmed `app/services/performance_service.py`, `app/services/portfolio_valuation.py`,
  `app/services/portfolio_allocation.py`, and `app/routers/portfolio.py` are byte-identical to
  before this change.

## What changed

- `app/services/portfolio_risk.py`: new `_pairwise_covariance`, `_risk_contributions`
  helpers; `build_risk_metrics_response` gains `risk_contributions` (additive — every existing
  key unchanged) and hoists the `requested_start`/`requested_end` date parsing to one place.
- `tests/test_portfolio_risk.py`: 4 new tests, plus the existing end-to-end integration test
  extended to assert the sum-to-100% property on real seeded data.
- `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md`: section 6, written by me before
  implementation, corrected once after Grok caught a real arithmetic inconsistency in the
  first draft's worked reference, before any implementation code existed.

## What this unit does not do

Does not use one shared date grid across every held security for the covariance matrix (each
pairwise entry keeps its own common-day window — a documented simplification, same as
correlation). Does not convert to a volatility-based decomposition. Does not add `POST
/risk/scenarios` (Phase 4.4, separate unit). This closes Phase 4.2's metrics table; `GET
/portfolio/attribution` (roadmap section 4.5's remaining named route) and the full custom-shock
Risk Lab backend remain open, unstarted. No frontend rendering. No merge or deploy is claimed.
