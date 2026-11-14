# Portfolio risk metrics (first slice) verification

Adds `GET /portfolio/risk-metrics` — the first slice of Phase 4.2's "Quantitative risk engine":
historical volatility and maximum drawdown only, of the nine metrics the roadmap's section 4.2
table lists. Design written first as `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md`. Concentration
(the third metric on that table) is already closed by the existing `GET /portfolio/allocation`
(PR #45) under a different name — not duplicated here. Beta, historical VaR, Expected Shortfall,
correlation, risk contribution, and stress-test loss remain open, separate, larger units.

## Implemented by Grok, independently verified by me

A new module, `app/services/portfolio_risk.py`, and one new route in
`app/routers/portfolio.py` — neither `performance_service.py` nor `portfolio_allocation.py` was
touched (confirmed with `git diff --stat`, empty on both). `build_risk_metrics_response` calls
the existing `build_performance_response` once as a black box and derives both numbers purely
from its already-published `series[].twr_index`/`series[].drawdown_pct` fields — no new
account-state or price query of its own.

- `max_drawdown_pct` is `max()` over the `drawdown_pct` values of every `"available"` series
  entry, formatted back to text unchanged (not re-quantized) — correctly reuses the exact
  `Decimal` the upstream field already produced rather than recomputing it from account values a
  second time, which could have silently diverged.
- `historical_volatility_pct` is the sample standard deviation (`ddof=1`, dividing by
  `return_count - 1`) of the period-over-period `twr_index` ratios, computed inside
  `localcontext(Context(prec=50))` — the same square-root idiom
  `market_indicators.py`'s Bollinger Bands code already established. Correctly `None` below two
  returns (a sample variance is undefined with fewer than two observations).
- A genuine self-check I did not explicitly ask for: `build_risk_metrics_response` raises an
  `AssertionError` if its own `return_count = max(observed_periods - 1, 0)` ever disagrees with
  the actual number of computed return ratios — a defensive internal consistency check, not a
  user-facing error path, that would catch a future refactor breaking the invariant rather than
  silently returning a wrong count.

## Independent verification

- Re-derived the contract's own reference vector in a separate script before review: `twr_index`
  sequence `1.000000, [gap], 1.050000, 0.980000, 1.030000, 1.000000` → four returns
  `0.05, -0.0666666666666666666666666666666666666666666666667,
  0.0510204081632653061224489795918367346938775510204,
  -0.0291262135922330097087378640776699029126213592233` → sample stdev `0.058847347858147...`
  → `historical_volatility_pct = "5.8847"`. Matched exactly.
- `drawdown_pct` values `0.0000, 0.0000, 6.6667, 1.9048, 4.7619` → `max_drawdown_pct = "6.6667"`.
  Matched exactly.
- Reviewed the full diff of all three touched files directly (not Grok's self-report) — the
  module, the one new route, and the new test file.
- `python -m pytest -q tests/test_portfolio_risk.py`: **5 passed** (all new): the mocked
  reference-vector test, a below-two-returns null-gating test, a zero-available-days test, an
  auth/range-validation test against the real route, and a real DB-seeded end-to-end test that
  additionally cross-checks `observed_periods` against `GET /portfolio/performance`'s own
  `series`' available-day count for that same account — a genuine independence check beyond what
  I asked for, not a restatement of already-covered digits.
- `python -m pytest -q` (full backend suite): **373 passed, 28 skipped**, 2 pre-existing
  unrelated Windows-local SQLite-locking errors (confirmed by reading their actual traceback —
  `PermissionError: [WinError 5] Access is denied` on a pytest temp directory — the same class of
  error documented since PR #27, not a new failure).
- No file outside `app/services/portfolio_risk.py` (new), `app/routers/portfolio.py` (one added
  route), and `tests/test_portfolio_risk.py` (new) was touched.

## What changed

- `app/services/portfolio_risk.py`: new module, `build_risk_metrics_response`.
- `app/routers/portfolio.py`: new `GET /risk-metrics` route, same `range` query parameter and
  inherited validation as `GET /performance`.
- `tests/test_portfolio_risk.py`: new file, 5 tests.
- `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md`: new contract, written by me before
  implementation, untouched by Grok.

## What this unit does not do

Does not add beta, historical VaR, Expected Shortfall, correlation, risk contribution, or
stress-test loss (each a separate, larger future unit). Does not add `GET /portfolio/attribution`.
Does not add an annualized volatility figure — the response is explicitly documented as
per-period, since gaps in the series make a `sqrt(252)` annualization misleading. No frontend
rendering. No merge or deploy is claimed.
