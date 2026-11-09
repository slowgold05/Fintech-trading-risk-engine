# Pairwise correlation (risk-metrics fourth slice) verification

Adds `correlations` to the existing `GET /portfolio/risk-metrics` response (PRs #47-#49) —
additive only, per `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 4, written before
implementation. The first metric in this response not derivable purely from
`build_performance_response`'s own fields: this unit makes a second black-box call,
`build_portfolio_response`, reading only its `positions` list (current non-zero holdings), plus
one small self-contained `MarketBarDaily` query. Seven of the roadmap's nine Phase 4.2 metrics
are now closed (concentration, historical volatility, max drawdown, beta, historical VaR,
Expected Shortfall, correlation); risk contribution and stress-test loss remain open.

## Implemented by Grok, independently verified by me

`performance_service.py`, `portfolio_valuation.py`, `portfolio_allocation.py`, and
`app/routers/portfolio.py` are all byte-identical to before this change (confirmed with `git
diff --stat`, empty on all four — `build_portfolio_response` is read, not modified). No private
(`_`-prefixed) function was imported from either module; the multi-provider ambiguity rule
(`performance_service.py`'s `_account_value` already enforces it) was independently reproduced
in a new, small, self-contained `_single_provider_closes` query, exactly as the contract
specified — a `(symbol, date)` with exactly one raw provider row is usable, zero or
two-or-more rows excludes that day for that symbol.

- `_pairwise_correlation` follows the file's existing conventions exactly:
  `localcontext(Context(prec=50))`, sample (`ddof=1`) covariance/variance (same shape as
  `_beta`), `FOUR_PLACES`/`ROUND_HALF_UP`/`format(x, "f")`, a `return_count < 2` null gate, and
  a `variance == 0` division-by-zero guard for either security.
- `_held_correlations` correctly returns `None` (not an empty list) when fewer than 2 symbols
  are currently held, and otherwise lists every one of the `C(n, 2)` pairs via
  `itertools.combinations` over an already-sorted `held_symbols` list — confirmed this naturally
  yields ascending pair order, with an explicit `.sort(key=...)` kept as a second guarantee
  rather than relying on that ordering alone.
- The reference test is a genuine end-to-end integration test, not a mock: it seeds two real
  `MarketBarDaily` symbols with 7 days of raw closes, deliberately inserting **two** distinct
  `provider` rows for `BBB` on day 4 (`"alpha"`/`"bravo"`, since the table's primary key is
  `(symbol, session_date, provider, adjustment_type)` — two rows with the same provider would
  simply collide, not create ambiguity) to prove the ambiguity-exclusion rule against the real
  query, not a hand-waved assumption. It also seeds a real account holding both symbols so
  `build_portfolio_response` runs for real, unmocked.
- A test I did not literally spell out but is a correct, useful addition:
  `test_correlation_pair_is_null_below_two_common_returns` monkeypatches
  `_single_provider_closes` directly (rather than seeding more DB rows) to exercise the
  `return_count == 0` and `return_count == 1` null-gate boundaries precisely, each confirmed via
  the pair's own `return_count` field in the response, not just its `correlation: null`.

## Independent verification

- Re-derived the contract's own two-symbol, seven-day reference in a separate script before
  review: `common_days` excludes day 4 (BBB ambiguous) → 5 returns → sample covariance
  `0.00043524385357...`, variances `0.00017266.../0.00138719...` → `correlation = "0.8893"`.
  Matched exactly.
- Reviewed the full diff of both touched files directly (not Grok's self-report).
- `python -m pytest -q tests/test_portfolio_risk.py`: **14 passed** (11 pre-existing + 3 new).
- `python -m pytest -q` (full backend suite): **382 passed, 28 skipped**, the same 2
  pre-existing unrelated Windows-local SQLite-locking errors (documented since PR #27).
- Confirmed `app/services/performance_service.py`, `app/services/portfolio_valuation.py`,
  `app/services/portfolio_allocation.py`, and `app/routers/portfolio.py` are byte-identical to
  before this change.

## What changed

- `app/services/portfolio_risk.py`: new `_single_provider_closes`, `_pairwise_correlation`,
  `_held_correlations` helpers; `build_risk_metrics_response` gains `correlations` (additive —
  every existing key unchanged). A second black-box call (`build_portfolio_response`) added
  alongside the existing `build_performance_response` call.
- `tests/test_portfolio_risk.py`: 3 new tests, plus every pre-existing test's `_install_series`
  helper extended to also stub `build_portfolio_response` (so each keeps passing with
  `correlations: None` on an empty mocked book).
- `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md`: section 4, written by me before
  implementation, untouched by Grok.

## What this unit does not do

Does not add risk contribution or stress-test loss (each a separate, larger future unit). Does
not compute correlation against the SPY benchmark (that is beta's job, already shipped). Does
not build a symbol-keyed correlation matrix data structure — a flat pair list only. Does not add
`GET /portfolio/attribution`. No frontend rendering. No merge or deploy is claimed.
