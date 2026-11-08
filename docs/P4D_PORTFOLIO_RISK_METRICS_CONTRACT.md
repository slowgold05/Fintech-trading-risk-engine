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
(each a separate future unit, as scoped above — beta is picked up immediately below in section
2, added after this slice shipped as PR #47). Does not add `GET /portfolio/attribution`. Does
not add an annualized volatility figure. Does not modify `performance_service.py` or
`portfolio_allocation.py`. No frontend rendering. No merge or deploy is claimed by writing this
contract.

## 2. Portfolio beta addendum (2026-11-08) — design, not yet implemented

Written before any code change, the same way section 15 of the indicator contract and this
contract's own section 1 were. Adds `portfolio_beta` and `beta_pair_count` to the same
`GET /portfolio/risk-metrics` response — additive only, section 1's existing fields are
unchanged. Still a single route; the roadmap's section 4.5 list names exactly one
`GET /portfolio/risk-metrics` endpoint for every metric on its table, not one route per metric.

### 2.1 Inputs — still a black-box reuse

Reuses the same single `build_performance_response` call this unit already makes. No second
call, no new query. Adds one more read of a field that call's `series` already publishes on
every entry regardless of account status: `benchmark_index` (the SPY `twr_index`-style chain
PR #41 added) — nullable independently of the account's own `status`, per that field's own
design ("the account chain and the SPY chain skip different days").

### 2.2 Paired days

```
paired = [(point["twr_index"], point["benchmark_index"])
          for point in series
          if point["status"] == "available" and point["benchmark_index"] is not None]
```

Only a day where **both** the account has a value and SPY has a value contributes a pair. The
two source chains are not filtered together elsewhere in this codebase, so a day where one is
present and the other is not is simply excluded from `paired` — it is not an error, and it does
not interrupt the chain (both `twr_index` and `benchmark_index` already correctly account for
gaps in their own chaining, so taking a direct ratio between two `paired` entries that are not
adjacent in the full `series` is still a valid return over whatever calendar span actually
elapsed, the same reasoning section 1's volatility calculation already relies on).

### 2.3 Beta

Let `P[0..M-1]` be the `twr_index` values and `S[0..M-1]` the `benchmark_index` values of
`paired`, in order. For `i in 1..M-1`:

```
p_return[i] = P[i] / P[i-1] - 1
s_return[i] = S[i] / S[i-1] - 1
```

`beta_pair_count = M - 1` (the number of return pairs, `0` if `M == 0`). With
`beta_pair_count < 2`, `portfolio_beta` is `null` (a sample covariance/variance needs at least 2
observations, the same threshold section 1's volatility already uses for the same reason).
Otherwise, inside the same `Context(prec=50)` `localcontext()` every other computation in this
module already uses:

```
mean_p = mean(p_return), mean_s = mean(s_return)
covariance = sum((p_return[i] - mean_p) * (s_return[i] - mean_s)) / (beta_pair_count - 1)
variance_s = sum((s_return[i] - mean_s) ** 2) / (beta_pair_count - 1)
portfolio_beta = covariance / variance_s
```

Both `covariance` and `variance_s` use the sample (`ddof=1`) convention, matching section 1's
volatility. If `variance_s == 0` (the benchmark showed no variation across the paired returns —
a degenerate case that should not occur with real SPY data, but is guarded against rather than
dividing by zero), `portfolio_beta` is `null`. Otherwise, quantized to 4 decimal places,
`ROUND_HALF_UP` — the same precision every other field in this response uses, even though beta
is a unitless ratio, not a percentage.

### 2.4 Worked reference (independently verified, not derived from the implementation)

Five paired days: `twr_index = [1.000000, 1.020000, 1.040000, 1.000000, 1.050000]`,
`benchmark_index = [1.000000, 1.010000, 1.020000, 1.005000, 1.015000]` (one real series day in
between these, with a present `twr_index` but a `null` `benchmark_index`, was excluded from
`paired` entirely — not shown here since it contributes nothing to the calculation).

```
p_return = [0.02, 0.0196078431372549019607843137254901960784313725490,
            -0.03846153846153846153846153846153846153846153846154, 0.05]
s_return = [0.01, 0.0099009900990099009900990099009900990099009900990,
            -0.01470588235294117647058823529411764705882352941176,
            0.0099502487562189054726368159203980099502487562189]
mean_p = 0.012786576168929110105580693815987933634992458521865
mean_s = 0.003786339125571907498036897631817615475331554226535
covariance = 0.00042120103459408850981938983297090496541526703676297
variance_s = 0.00015198485837817604292545915627560159988347915079349
portfolio_beta = covariance / variance_s = 2.7713355072913632886581510859955567536939492729531
             → quantized = "2.7713"
```

`beta_pair_count = 4`.

### 2.5 What this addendum does not do

Does not add VaR, Expected Shortfall, correlation, risk contribution, or stress-test loss. Does
not annualize beta (it is already scale-invariant between covariance and variance over the same
period length, so no annualization question arises the way it does for volatility). Does not
change `performance_service.py` — still a pure consumer of its already-published fields.

## 3. Historical VaR and Expected Shortfall addendum (2026-11-08) — design, not yet implemented

Written before any code change, same pattern as sections 1 and 2. Adds four fields —
`historical_var_95_pct`, `historical_var_99_pct`, `expected_shortfall_95_pct`,
`expected_shortfall_99_pct` — to the same `GET /portfolio/risk-metrics` response, additive
only. Still no change to `performance_service.py`: this reuses the exact same per-period
`twr_index` returns section 1's volatility calculation already derives (not the
benchmark-paired returns section 2 introduced).

### 3.1 Method — nearest-rank empirical quantile

Let `return[1..N-1]` be the same period-over-period `twr_index` ratios section 1 already
computes (`N` = `observed_periods`, so there are `return_count = N - 1` returns). Sort them
ascending: `sorted_return[0]` is the worst (most negative) period return.

For confidence level `c` (`0.95` or `0.99`), the nearest-rank index is
`rank(c) = ceil((1 - c) * return_count)`, clamped to at least `1`. `historical_var_<c>_pct` is
`-sorted_return[rank(c) - 1]`, expressed as a positive percentage (a positive number means a
loss of that percentage; the method reports the magnitude of a loss, not a signed return) —
`"2.2300"` means a 95% one-period VaR of 2.23% of portfolio value. `expected_shortfall_<c>_pct`
is the mean of the worst `rank(c)` returns (`sorted_return[0 .. rank(c)-1]`), also negated to a
positive loss percentage — by construction, Expected Shortfall is always `>=` the VaR at the
same confidence level, since it averages in everything at or beyond the VaR cutoff rather than
reading off a single point.

Both quantized to 4 decimal places, `ROUND_HALF_UP`, same as every other `_pct` field in this
response. Arithmetic inside the same `Context(prec=50)` `localcontext()` the rest of this
module already uses.

### 3.2 Minimum sample size — an explicit, documented limitation

The nearest-rank method degenerates badly on a short sample: with `return_count < 20`, `rank(c)`
is `1` for *both* `c = 0.95` and `c = 0.99`, which would silently make the 95% and 99% figures
identical — not because the portfolio's tail risk is actually the same at both confidence
levels, but purely because there are not enough observations to tell them apart. Rather than
publish that misleading coincidence, this unit sets an explicit floor, directly serving the
roadmap's own acceptance criterion ("Missing or insufficient market history produces an explicit
unavailable result rather than a misleading estimate"):

- `return_count < 20`: all four fields are `null`.
- `20 <= return_count < 100`: `historical_var_95_pct`/`expected_shortfall_95_pct` are computed;
  `historical_var_99_pct`/`expected_shortfall_99_pct` stay `null` (fewer than 100 observations
  cannot meaningfully separate the top 1% tail from the top 5% tail under nearest-rank — `rank(0.99)`
  would still equal `1` for any `return_count` from 20 to 99, identical to `rank(0.95)`'s
  behavior at the smallest sizes in that range, which is exactly the coincidence being guarded
  against).
- `return_count >= 100`: all four fields are computed.

These thresholds (20, 100) are a documented policy choice, not a law of statistics — they are
deliberately conservative so this unit never reports a number implying more precision than a
short paper-trading history actually supports. A future unit could revisit them.

### 3.3 Worked reference (independently verified, not derived from the implementation)

121 available days (`twr_index` values, `T[0]=1.000000` through `T[120]`), generated with a
fixed-seed synthetic random walk and verified with a standalone `Decimal`/`Context(prec=50)`
script — not hand-picked to produce a convenient answer. `return_count = 120`.

```
rank(0.95) = ceil(0.05 * 120) = 6   → historical_var_95_pct      = "2.2300"
rank(0.99) = ceil(0.01 * 120) = 2   → historical_var_99_pct      = "2.3872"
expected_shortfall_95_pct (mean of the worst 6 returns)  = "2.3300"
expected_shortfall_99_pct (mean of the worst 2 returns)  = "2.4333"
```

Confirms the expected ES >= VaR relationship at both confidence levels (`2.3300 >= 2.2300`,
`2.4333 >= 2.3872`). The exact 121-value `twr_index` sequence used to derive these four numbers
is given to the implementer directly (see the task file), not reconstructed from this contract
alone, to avoid a transcription error between the contract and the test fixture.

### 3.4 What this addendum does not do

Does not add correlation, risk contribution, or stress-test loss. Does not use a parametric
(variance-covariance) or Monte Carlo VaR method — nearest-rank empirical quantile only. Does not
scale VaR/ES by actual portfolio dollar value (these are percentages of portfolio value, not
dollar amounts — a caller multiplies by `total_account_value` from another response if a dollar
figure is needed). Does not change `performance_service.py` or either of the two existing risk
fields from sections 1-2.
