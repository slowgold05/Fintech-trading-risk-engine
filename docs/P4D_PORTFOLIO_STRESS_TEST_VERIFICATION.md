# Stress-test loss (risk-metrics fifth slice) verification

Adds `stress_scenarios` to the existing `GET /portfolio/risk-metrics` response (PRs #47-#50) —
additive only, per `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 5, written before
implementation. All nine of the roadmap's Phase 4.2 metrics are now closed in some form:
concentration, historical volatility, max drawdown, beta, historical VaR, Expected Shortfall,
correlation, and now stress-test loss — the ninth, risk contribution, remains a separate,
larger, unstarted unit (it needs the full covariance-matrix risk model this slice does not
build). This is a fixed, small, three-scenario set, not the full custom-shock Risk Lab backend
(`POST /risk/scenarios`, roadmap section 4.5, a separate Phase 4.4 unit).

## Implemented by Grok, independently verified by me

A third black-box call, `build_allocation_response` (the first use of
`portfolio_allocation.py` from this module). `performance_service.py`,
`portfolio_valuation.py`, and `portfolio_allocation.py` are all byte-identical to before this
change; `app/routers/portfolio.py` is also unchanged (no route change needed).

- `broad_market_selloff` (10%) and `technology_sector_selloff` (25%, filtered by each
  security's already-classified `sector` field — no reclassification) both correctly report a
  real `"0.00"`/`"0.0000"` when nothing qualifies, rather than `null` — a genuinely correct
  distinction from the `allocation["status"] != "complete"` case, which nulls the entire list.
- `single_security_worst_holding` (30%) correctly picks the largest `position_value` with an
  explicit ascending-symbol tiebreak, and degrades to an all-`null` entry (but still present in
  the list) when there is nothing priced to shock — proven by a dedicated test that also checks
  the *other two* scenarios still report real zeros in that same zero-priced-securities case,
  correctly distinguishing "nothing to shock" from "unavailable."
- `_scenario_loss`'s own docstring is explicit that the dollar sum is taken before cent
  rounding, and the percentage is computed from the already-rounded cent value, not the raw
  sum — avoiding a double-rounding inconsistency between `loss` and `loss_pct`.

## Independent verification

- Re-derived the contract's own reference (`P4C_PORTFOLIO_ALLOCATION_CONTRACT.md`'s fixture:
  cash `$1000`, AAPL/Technology `$300`, JPM/Financials `$200`, XOM/Energy `$100`, total `$1600`)
  in a separate script before review: `broad_market_selloff` loss `$60.00` → `"3.7500"`;
  `technology_sector_selloff` loss `$75.00` (AAPL only) → `"4.6875"`; `single_security_
  worst_holding` loss `$90.00` (AAPL, the largest holding) → `"5.6250"`. Matched exactly.
- Reviewed the full diff of both touched files directly (not Grok's self-report).
- `python -m pytest -q tests/test_portfolio_risk.py`: **18 passed** (14 pre-existing + 4 new).
- `python -m pytest -q` (full backend suite): **386 passed, 28 skipped**, the same 2
  pre-existing unrelated Windows-local SQLite-locking errors (documented since PR #27).
- Confirmed `app/services/performance_service.py`, `app/services/portfolio_valuation.py`,
  `app/services/portfolio_allocation.py`, and `app/routers/portfolio.py` are byte-identical to
  before this change.
- CI note: this unit's own PR (#50, the *previous* slice's PR, pushed just before this one was
  scoped) hit a `browser` job failure on its doc-only backlog-note commit —
  `test_p3b_watchlists_ui.py::test_private_watchlists_ui`'s `StaleElementReferenceException`.
  Read the actual failure log (`gh run view ... --log-failed`) before assuming anything;
  confirmed it is the exact same previously-documented flake (unrelated to any backend change in
  this session), reran via `gh run rerun ... --failed`.

## What changed

- `app/services/portfolio_risk.py`: new `CENT` constant, `_priced_securities`,
  `_scenario_loss`, `_loss_pct`, `_stress_scenarios` helpers; `build_risk_metrics_response`
  gains `stress_scenarios` (additive — every existing key unchanged). A third black-box call
  (`build_allocation_response`) added alongside the existing two.
- `tests/test_portfolio_risk.py`: 4 new tests, plus every pre-existing test's `_install_series`
  helper extended to also stub `build_allocation_response` with a default complete/empty
  allocation.
- `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md`: section 5, written by me before
  implementation, untouched by Grok.

## What this unit does not do

Does not add risk contribution (the ninth and final metric on the roadmap's table — needs a
full covariance-matrix risk model, a separate future unit now that correlation's building
blocks exist). Does not add `POST /risk/scenarios` (Phase 4.4's custom-shock Risk Lab backend).
Does not model interest-rate shocks. Does not change any of the three modules this unit reads
as a black box. No frontend rendering. No merge or deploy is claimed.
