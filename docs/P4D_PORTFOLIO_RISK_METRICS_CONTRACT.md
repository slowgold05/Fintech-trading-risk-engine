# Portfolio risk metrics (first slice) — contract

Roadmap Phase 4.2 "Quantitative risk engine" lists nine metrics (historical volatility, beta,
historical VaR, Expected Shortfall, maximum drawdown, concentration, correlation, risk
contribution, stress-test loss) behind one named route in section 4.5:
`GET /portfolio/risk-metrics`. This is a large surface; this contract scopes a first slice, not
the whole engine, the same way earlier Phase 4.1 units each shipped one metric at a time rather
than the full performance series in one unit. Written before implementation.

## Scope of this slice

Two metrics only: **historical volatility** and **maximum drawdown**. Both are derivable purely
from fields `GET /portfolio/performance` already publishes — `twr_index` and `drawdown_pct` —
so this unit is a new, isolated module that reuses `build_performance_response` once as a black
box, the same reuse pattern `portfolio_allocation.py` already established for
`build_portfolio_response`. **No modification to `performance_service.py`.**

"Concentration" (security and sector weights) is already closed by the existing
`GET /portfolio/allocation` (PR #45) — that route already reports exactly this metric under a
different name. This unit does not duplicate it.

Out of scope, each a separate future unit: beta (needs a benchmark-return regression/covariance
against the existing `benchmark_index` chain), historical VaR and Expected Shortfall (need the
full historical return distribution exposed, not just its stdev), correlation (needs
multi-security return series, not a single portfolio-level one), risk contribution (needs a
portfolio risk model built on top of the above), stress-test loss (needs defined shock
scenarios, shared with Phase 4.4's Risk Lab). `GET /portfolio/attribution` is also out of scope
(separate route, separate unit).

## New module and route

`app/services/portfolio_risk.py`: `build_risk_metrics_response(db, user_id, email,
range_token) -> dict`. Calls `build_performance_response(db, user_id, email, range_token)` once,
reads its `series` (and `status`), and derives the two metrics below. Route:
`GET /portfolio/risk-metrics?range=1y|2y` in `app/routers/portfolio.py`, same `range` query
parameter and `422`/`range must be 1y or 2y.` validation `GET /portfolio/performance` already
enforces (that validation lives inside `build_performance_response` itself and is inherited for
free by calling it).

## Response shape

```
{
  "user": {"id": ..., "email": ...},
  "range": "1y" | "2y",
  "requested_start": <date>, "requested_end": <date>,
  "read_at": <iso>,
  "status": "complete" | "incomplete",
  "observed_periods": <int>,
  "return_count": <int>,
  "historical_volatility_pct": "5.8847" | null,
  "max_drawdown_pct": "6.6667" | null
}
```

`user`, `range`, `requested_start`, `requested_end`, `read_at`, `status` are passed through
unchanged from the underlying performance response (same values, not re-derived) — this keeps
the two responses trivially cross-checkable by a caller that reads both. `observed_periods` is
the count of `series` entries with `status == "available"`. `return_count` is
`max(observed_periods - 1, 0)` — the number of period-over-period `twr_index` ratios used for
volatility.

## 1. Historical volatility

Let `T[0..N-1]` be the `twr_index` values of every `"available"` entry in `series`, in order
(an `"unavailable"` gap day is simply skipped — it contributes no `twr_index`, and the next
available day's own `twr_index` already correctly chains across that gap, per
`performance_service.py`'s own docstring). For each consecutive pair:

```
return[i] = T[i] / T[i-1] - 1    for i in 1..N-1
```

`historical_volatility_pct` is the **sample** standard deviation of `return[1..N-1]`: divide the
sum of squared deviations from the mean by `return_count - 1` (`ddof=1`, not `return_count`, the
standard correction for estimating a population stdev from a sample), take the square root, then
express as a percentage, quantized to 4 decimal places `ROUND_HALF_UP` (the same precision
`drawdown_pct`/`money_weighted_return_pct` already use). `Decimal.sqrt()` inside a
`Context(prec=50)`, consistent with every other square-root computation in this codebase
(`market_indicators.py`'s Bollinger Bands stdev).

Requires `return_count >= 2` (at least 3 available days) — a sample standard deviation is
undefined with fewer than 2 observations (division by zero). Below that threshold,
`historical_volatility_pct` is `null`.

**Explicit limitation, stated directly in the response's own documentation (not hidden):** this
is a **per-period**, not an annualized, volatility. Because `series` can contain gaps (an
`"unavailable"` day), the calendar spacing between two consecutive available `twr_index` values
is not guaranteed to be exactly one trading day, so multiplying by `sqrt(252)` to "annualize"
would silently misstate the figure whenever a gap exists. A later unit could add an explicitly
labeled annualized figure once gap-spacing is accounted for; this slice does not claim one.

## 2. Maximum drawdown

```
max_drawdown_pct = max(drawdown_pct for every "available" entry in series)
```

A direct reuse of the existing, already-verified `drawdown_pct` field — no new arithmetic, just
a maximum over values that are already decimal text at 4 places. `null` only when there are zero
`"available"` entries (an account with no priced history at all); with even one available day,
`drawdown_pct` is a real measured `"0.0000"` for that day (the existing field's own convention),
so `max_drawdown_pct` is `"0.0000"`, not `null`, in that case.

## Reference (independently verified, not derived from the implementation)

Five `"available"` entries' `twr_index`: `1.000000, 1.050000, 0.980000, 1.030000, 1.000000`
(one `"unavailable"` gap day sits between entries, irrelevant to the chain). Four
period-over-period returns:

```
r1 = 1.050000/1.000000 - 1 =  0.05
r2 = 0.980000/1.050000 - 1 = -0.0666666666666666666666666666666666666666666666667
r3 = 1.030000/0.980000 - 1 =  0.0510204081632653061224489795918367346938775510204
r4 = 1.000000/1.030000 - 1 = -0.0291262135922330097087378640776699029126213592233
```

`mean = 0.0013068819760914074367611122118750412786473812826075`
`sample variance (÷3) = 0.0034630103499377607092411097042183415571762063422837`
`sample stdev = 0.058847347858147020398598437115829702765378562944485`
`historical_volatility_pct = (stdev * 100) quantized = "5.8847"`

Independently verified with a standalone `Decimal`/`Context(prec=50)` script before
implementation, not derived from the code under test.

`drawdown_pct` across the same five available entries:
`0.0000, 0.0000, 6.6667, 1.9048, 4.7619` → `max_drawdown_pct = "6.6667"`.

`observed_periods = 5`, `return_count = 4`.

## What this unit does not do

Does not add beta, VaR, Expected Shortfall, correlation, risk contribution, or stress-test loss
(each a separate future unit, as scoped above). Does not add `GET /portfolio/attribution`. Does
not add an annualized volatility figure. Does not modify `performance_service.py` or
`portfolio_allocation.py`. No frontend rendering. No merge or deploy is claimed by writing this
contract.
