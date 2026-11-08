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

## 4. Pairwise correlation addendum (2026-11-08) — design, not yet implemented

Written before any code change, same pattern as sections 1-3. Adds `correlations` to the same
`GET /portfolio/risk-metrics` response, additive only. Unlike sections 1-3, this is the first
metric in this response that is **not** derivable purely from `build_performance_response`'s
already-published fields — correlation needs each currently-held security's own historical
closes, not just the portfolio-level `twr_index` chain. This unit therefore makes a second
black-box call, `build_portfolio_response(db, user_id, email)` (the same function
`portfolio_allocation.py` already reuses), purely to read its `positions` list — the current,
non-zero holdings — and one new, small, self-contained query against `MarketBarDaily` for those
symbols' raw closes over the response's existing `requested_start`/`requested_end` window. No
private helper from `performance_service.py` is imported (this unit does not reach into another
module's underscore-prefixed functions); the ambiguity rule below is a small, intentional
duplication of the one rule `performance_service.py`'s own `_account_value` already enforces,
not a shared import, to keep this module's only cross-module dependency on
`performance_service.py` the two existing public black-box calls.

### 4.1 Symbol universe and price source

`held_symbols = sorted({position["symbol"] for position in portfolio["positions"]})` — the
current non-zero holdings only (not every symbol ever traded). If `len(held_symbols) < 2`, no
pair is possible: `correlations` is `null` (not an empty list — there is nothing to compute, the
same "insufficient information" distinction the rest of this contract already draws).

For each held symbol, one query reads every `MarketBarDaily` row with `adjustment_type ==
"raw"` in `[requested_start, requested_end]` for that symbol's set, grouped by `(symbol,
session_date)`. **Same multi-provider ambiguity rule `performance_service.py`'s
`_account_value` already enforces:** a `(symbol, date)` with exactly one raw close row is
usable; zero or two-or-more rows for that same `(symbol, date)` makes that day unusable for that
symbol (not an error — simply excluded from that symbol's own close series).

### 4.2 Pairwise return correlation

For each pair `(symbol_a, symbol_b)` with `symbol_a < symbol_b` (lexicographic, so the pair list
has no duplicate reversed entries and a stable order): `common_days` is the sorted intersection
of both symbols' own usable-day sets. Period-over-period simple returns over `common_days`'
closes (same `price[i]/price[i-1] - 1` shape as every other return calculation in this module —
note these are **not** chained TWR-style indices like sections 1-2 use; they are plain
consecutive raw-price ratios, since there is no flow/cash-contribution concept for a single
security's own price). `return_count = len(common_days) - 1` (`0` if `len(common_days) == 0`).

With `return_count < 2`, that pair's `correlation` is `null` (a sample correlation needs at
least 2 observations, same threshold section 2's beta already uses for the same reason).
Otherwise, inside the same `Context(prec=50)` `localcontext()`:

```
mean_a = mean(a_returns), mean_b = mean(b_returns)
covariance = sum((a_returns[i] - mean_a) * (b_returns[i] - mean_b)) / (return_count - 1)
variance_a = sum((a_returns[i] - mean_a) ** 2) / (return_count - 1)
variance_b = sum((b_returns[i] - mean_b) ** 2) / (return_count - 1)
correlation = covariance / sqrt(variance_a * variance_b)
```

If either `variance_a == 0` or `variance_b == 0` (one security showed zero price movement
across the common days — a guard, not expected with real market data), `correlation` is `null`.
Otherwise quantized to 4 decimal places, `ROUND_HALF_UP`, same as every other field in this
response. A correlation coefficient is dimensionless (always in `[-1, 1]` by construction when
defined), so this is the one field in this response that is not itself a dollar amount or a
percentage despite sharing the same decimal-text convention.

### 4.3 Response shape addition

```
"correlations": [
  {"symbols": ["AAPL", "JPM"], "return_count": 5, "correlation": "0.8893" | null},
  ...
] | null
```

One entry for every one of the `C(len(held_symbols), 2)` pairs when `len(held_symbols) >= 2`,
ordered by `symbols` ascending (first by `symbols[0]`, then `symbols[1]`) — every pair is always
listed, even one whose `correlation` turns out `null`, so a caller can see *which* pair lacked
enough overlapping price history, the same transparency principle `GET /portfolio/allocation`'s
always-present `securities` list (even for an unpriced holding) already established.

### 4.4 Worked reference (independently verified, not derived from the implementation)

Two symbols, seven calendar days of raw closes. Symbol A: a single unambiguous close every day.
Symbol B: a single unambiguous close on every day except day 4, where **two** raw close rows
exist for that same `(symbol, date)` — making day 4 unusable for B (and therefore for the pair,
since the day is only usable when both symbols have a usable close):

```
Day:       1       2       3       4 (B ambiguous)  5       6       7
A close:   100.000000  102.000000  101.000000  104.000000  103.000000  105.000000  107.000000
B close:   50.000000   51.000000   49.000000   (excluded)  52.000000   54.000000   55.000000
```

`common_days = [1, 2, 3, 5, 6, 7]` (day 4 excluded) → `return_count = 5`:

```
a_returns = [0.02, -0.00980392156862745098039215686274509803921568627451,
             0.0198019801980198019801980198019801980198019801980,
             0.0194174757281553398058252427184466019417475728155,
             0.0190476190476190476190476190476190476190476190476]
b_returns = [0.02, -0.03921568627450980392156862745098039215686274509804,
             0.0612244897959183673469387755102040816326530612245,
             0.0384615384615384615384615384615384615384615384615,
             0.0185185185185185185185185185185185185185185185185]
covariance = 0.0004352438535740983612261656249775837309240840909822
variance_a = 0.00017266119452185244984350376253074614116717932830619
variance_b = 0.0013871936922561708854880149110690569535114319917560
correlation = covariance / sqrt(variance_a * variance_b)
            = 0.88933774225296502921577912385261715621948278828407
            → quantized = "0.8893"
```

Independently verified with a standalone `Decimal`/`Context(prec=50)` script before
implementation, not derived from the code under test.

### 4.5 What this addendum does not do

Does not add risk contribution or stress-test loss. Does not compute correlation against the
SPY benchmark (that is beta's job, already shipped in section 2) — this is security-to-security
only. Does not build a full correlation matrix data structure keyed by symbol-symbol lookup; the
flat pair-list shape in 4.3 is deliberately simpler to serialize and test. Does not change
`performance_service.py` or `portfolio_allocation.py` — this is the module's second black-box
call to `build_portfolio_response`, reading only `positions`, nothing else from that response.

## 5. Stress-test loss addendum (2026-11-08) — design, not yet implemented

Written before any code change, same pattern as sections 1-4. Adds `stress_scenarios` to the
same `GET /portfolio/risk-metrics` response, additive only. This is a **fixed, small set of
canned scenarios**, not the full custom scenario builder — `POST /risk/scenarios` (roadmap
section 4.5's separate route, backing Phase 4.4's interactive Risk Lab where a user picks
arbitrary shocks) remains a separate, later, larger unit. This slice gives the roadmap's 4.2
metrics table its ninth and final entry a first, deliberately simple answer: a short list of
pre-defined shocks applied to the account's current holdings, reusing
`GET /portfolio/allocation`'s own already-published position values and sector classification
as a third black-box call (`build_allocation_response`, already imported by nothing else in
this module — this is its first use here).

### 5.1 The three fixed scenarios

No query parameter, no configurability in this unit — the same deliberate "fixed, not
configurable" choice this codebase has made before (MACD's periods, Bollinger's band width).
Every scenario is a pure revaluation: cash is never shocked (it carries no price risk), and a
shock only reduces (never increases) a security's `position_value` for this unit's purposes,
since "stress-test loss" by definition studies downside scenarios.

1. **`broad_market_selloff`**: every currently-held, priced security's `position_value` is
   reduced by `10%`.
2. **`technology_sector_selloff`**: every currently-held, priced security classified
   `"Technology"` (the same `sector_classifier.py` classification `GET /portfolio/allocation`
   already computes) is reduced by `25%`; every other security is unaffected. A holding with
   zero Technology exposure correctly produces a real, measured `"0.00"` loss for this scenario,
   not `null` — the account genuinely has no Technology-driven loss to report.
3. **`single_security_worst_holding`**: the single currently-held, priced security with the
   **largest** `position_value` (ties broken by ascending symbol, for determinism) is reduced
   by `30%`; every other security is unaffected. With zero currently-held, priced securities at
   all (a cash-only account, or one where every holding is unpriced), there is no "worst
   holding" to shock: this scenario's `loss`/`loss_pct`/`affected_symbol` are all `null` (the
   entry is still present in the list, for the same transparency reason section 4.3 already
   established for a correlation pair that could not be computed).

### 5.2 Computation

For a scenario with a shock set `shocked = {symbol: shock_fraction}` (e.g. `{"AAPL": Decimal
("0.25")}` for scenario 2 if `AAPL` is the account's only Technology holding):

```
loss = sum(position_value[symbol] * shock_fraction for symbol in shocked)
loss_pct = loss / total_account_value * 100
```

`total_account_value` and every `position_value` come directly from
`build_allocation_response`'s own already-computed, already-cent-quantized fields — this unit
does not re-derive them from `build_portfolio_response` a second time. `loss` quantized to
cents, `loss_pct` to 4 decimal places, `ROUND_HALF_UP`, matching every other dollar/percentage
field in this codebase.

### 5.3 Gating — the same all-or-nothing rule `GET /portfolio/allocation` already established

When the underlying allocation's own `status == "incomplete"` (one or more held position is
unpriced), `stress_scenarios` is `null` in its entirety — not a partial list computed only over
the priced subset, for the exact same reason `GET /portfolio/allocation`'s own weights go null
in that case: a stress-test loss computed while ignoring an unpriced holding's unknown exposure
would be a misleading understatement, not an honest "unavailable."

### 5.4 Response shape

```
"stress_scenarios": [
  {"scenario": "broad_market_selloff", "shock_pct": "-10.0000",
   "loss": "60.00", "loss_pct": "3.7500"},
  {"scenario": "technology_sector_selloff", "shock_pct": "-25.0000",
   "loss": "75.00", "loss_pct": "4.6875"},
  {"scenario": "single_security_worst_holding", "shock_pct": "-30.0000",
   "affected_symbol": "AAPL", "loss": "90.00", "loss_pct": "5.6250"}
] | null
```

`shock_pct` is a fixed literal per scenario (`"-10.0000"`/`"-25.0000"`/`"-30.0000"`), not a
computed value — included so a caller does not have to hardcode the three scenarios' own
magnitudes elsewhere. `affected_symbol` appears only on the third scenario (the other two shock
every qualifying security, not one named symbol).

### 5.5 Worked reference (independently verified, not derived from the implementation)

Reuses `GET /portfolio/allocation`'s own already-independently-verified reference fixture
(section matching `docs/P4C_PORTFOLIO_ALLOCATION_CONTRACT.md`'s reference): cash `$1000.00`,
`AAPL` (`Technology`) `$300.00`, `JPM` (`Financials`) `$200.00`, `XOM` (`Energy`) `$100.00`,
`total_account_value = $1600.00`.

```
broad_market_selloff:        loss = (300.00 + 200.00 + 100.00) * 0.10 = 60.00
                              loss_pct = 60.00 / 1600.00 * 100 = "3.7500"
technology_sector_selloff:    loss = 300.00 * 0.25 = 75.00   (only AAPL is Technology)
                              loss_pct = 75.00 / 1600.00 * 100 = "4.6875"
single_security_worst_holding: largest holding is AAPL ($300.00); loss = 300.00 * 0.30 = 90.00
                              loss_pct = 90.00 / 1600.00 * 100 = "5.6250"
```

Deliberately chosen with three distinct percentages that do not coincide (an earlier draft of
this worked example picked a tech shock that happened to numerically match the broad-market
loss by coincidence — corrected to `25%` specifically so the three reference numbers are
visibly distinct and not mistakable for a copy-paste error in review).

### 5.6 What this addendum does not do

Does not add `POST /risk/scenarios` (the full custom-shock Risk Lab backend, Phase 4.4, a
separate and much larger unit — user-chosen symbols/sectors/magnitudes, not a fixed list). Does
not model interest-rate shocks (this app holds equities/ETFs only; a rate shock needs a duration/
factor model this unit does not build). Does not change `build_allocation_response`,
`build_portfolio_response`, or `performance_service.py` — a third black-box read only.

## 6. Risk contribution addendum (2026-11-08) — design, not yet implemented

Written before any code change, same pattern as sections 1-5. Adds `risk_contributions` to the
same `GET /portfolio/risk-metrics` response, additive only — this closes the ninth and final
metric on the roadmap's section 4.2 table. Reuses `build_allocation_response` (already read for
section 5's stress scenarios) for weights, and the same raw-close/common-day machinery section
4 already built for correlation (`_single_provider_closes`), extended to also compute the raw
(unnormalized) sample covariance between every pair of held securities, not just the
correlation coefficient.

### 6.1 The portfolio risk model

Let `held` be the currently-held, priced securities only (`price_status == "available"`,
`position_value` and `weight_pct` both non-null) from `build_allocation_response`'s
`securities` — cash is excluded from this list entirely. For each `held[i]`, `weight[i] =
Decimal(weight_pct[i]) / 100` (a fraction of `total_account_value`, the exact same weight the
allocation response already publishes as a percentage).

For every pair `(i, j)` with `i <= j` (including `i == j`, the diagonal, each security's own
variance against itself), compute the sample covariance of period-over-period simple returns
over that pair's own common usable days (`i == j` reduces to that one security's own sample
variance) — the exact same `_pairwise_correlation`-style common-days/return-count machinery
section 4 already established, but returning the raw covariance, not the normalized
correlation coefficient. **This is a deliberate, documented simplification**: each pairwise
covariance is computed over that pair's own common-day window, not one single aligned date
grid shared across every held security simultaneously — the same simplification section 4
already made for correlation. A more rigorous multi-asset model would use one shared date grid;
this unit does not build that.

If **any** required covariance entry (diagonal or off-diagonal) cannot be computed (fewer than 2
common/own returns for that pair), `risk_contributions` is `null` in its entirety — the
interlocking nature of a covariance matrix means one missing entry invalidates the whole
decomposition, the same all-or-nothing principle sections 3 and 5 already apply for their own
different reasons.

### 6.2 Variance decomposition (Euler's theorem on a quadratic form)

```
(Σw)[i] = sum(covariance[i][j] * weight[j] for j in held)
portfolio_variance = sum(weight[i] * (Σw)[i] for i in held)
contribution[i] = weight[i] * (Σw)[i]
risk_contribution_pct[i] = contribution[i] / portfolio_variance * 100
```

By construction (`w^T Σ w` is a quadratic form, and `Σ_i weight[i] * (Σw)[i]` is exactly its own
expansion), `sum(contribution[i] for i in held) == portfolio_variance` **exactly** — so
`sum(risk_contribution_pct[i] for i in held) == "100.0000"` exactly whenever the field is
non-null, the same explicit, checkable sum-to-100% property `GET /portfolio/allocation`'s own
weights already guarantee. This is contribution to portfolio **variance**, not volatility
(standard deviation) — a deliberate simplification that avoids an extra `sqrt`, and still
produces the same additive, sum-to-100% decomposition a volatility-based version would (scaling
every component by the same `1/sqrt(portfolio_variance)` factor to convert variance
contributions into volatility contributions would not change their *relative* percentages).

If `portfolio_variance <= 0` (a degenerate case — every held security showing zero variance,
not expected with real market data but guarded against), `risk_contributions` is `null`. With
zero held, priced securities at all, `risk_contributions` is `null` (nothing to decompose).
Each `risk_contribution_pct` quantized to 4 decimal places, `ROUND_HALF_UP`.

### 6.3 Response shape

```
"risk_contributions": [
  {"symbol": "AAA", "weight_pct": "60.0000", "risk_contribution_pct": "33.7947"},
  {"symbol": "BBB", "weight_pct": "40.0000", "risk_contribution_pct": "66.2053"}
] | null
```

Ordered by `symbol` ascending, same convention as `GET /portfolio/allocation`'s own
`securities` list. `weight_pct` is copied straight through from `build_allocation_response`
(not recomputed), so a caller can directly compare a security's capital weight against its risk
weight — the entire point of this metric (a security can carry a disproportionately large share
of portfolio risk relative to its dollar weight, which is exactly what this field exposes).

### 6.4 Worked reference (independently verified, not derived from the implementation)

Two held securities, weights `60%`/`40%`, reusing section 4.4's own seven-day `AAA`/`BBB`
closes. **Important, and the reason this reference was corrected after an initial draft got it
wrong:** the diagonal entry for `AAA` is *not* section 4.4's `var_a` — that figure was computed
over the `AAA`∩`BBB` *common*-day window (6 days, 5 returns, since `BBB`'s day 4 was ambiguous
and excluded from the pair entirely). Per section 6.1, the diagonal is each security's **own**
sample variance — `AAA` has no ambiguity of its own, so its own usable-day set is the full 7
days (6 returns), not the pair-restricted 5. `BBB`'s own diagonal happens to equal section
4.4's `var_b` exactly, because `BBB`'s own full usable-day set (6 days, with day 4 already
excluded for `BBB` on its own merits) coincides with the `AAA`∩`BBB` intersection in this
particular example — that coincidence does not generalize to `AAA`.

```
var(AAA), AAA's own 6 returns over all 7 of its own usable days (no ambiguity of its own):
  returns = [0.02, -0.0098039215686274509803921568627450980392156862745,
             0.029702970297029702970297029702970297029702970297,
             -0.0096153846153846153846153846153846153846153846154,
             0.0194174757281553398058252427184466019417475728155,
             0.0190476190476190476190476190476190476190476190476]
  var(AAA) = 0.00028459142482739615947657075752608920826080589756838

var(BBB) (BBB's own 5 returns over its own 6 usable days) = section 4.4's var_b
  = 0.0013871936922561708854880149110690569535114319917560

covariance(AAA, BBB) over the AAA∩BBB common 6 days (5 returns, day 4 excluded) =
  section 4.4's covariance_ab = 0.00043524385357409836122616562497758373092408409098 22

(Σw)_AAA = 0.6 * var(AAA) + 0.4 * covariance(AAA, BBB)
         = 0.00034485239632607704017640870450668701732611717493303
(Σw)_BBB = 0.6 * covariance(AAA, BBB) + 0.4 * var(BBB)
         = 0.00081602378904692737093090533941417301995902325129040
contribution_AAA = 0.6 * (Σw)_AAA = 0.00020691143779564622410584522270401221039567030495982
contribution_BBB = 0.4 * (Σw)_BBB = 0.00032640951561877094837236213576566920798360930051616
portfolio_variance = contribution_AAA + contribution_BBB
                    = 0.00053332095341441717247820735846968141837927960547598
risk_contribution_pct_AAA = contribution_AAA / portfolio_variance * 100 → "38.7968"
risk_contribution_pct_BBB = contribution_BBB / portfolio_variance * 100 → "61.2032"
```

`"38.7968" + "61.2032" == "100.0000"` exactly — confirms the Euler-decomposition identity.
`BBB`, the smaller dollar weight (`40%`), still carries the larger risk share (`61.2032%`)
because its own return series is far more volatile than `AAA`'s — the metric correctly surfaces
that concentration-by-dollar-weight and concentration-by-risk can diverge, which is the entire
reason this metric exists on the roadmap's table as something distinct from "concentration"
(security/sector weights, already closed by `GET /portfolio/allocation`).

(An earlier draft of this section mistakenly reused section 4.4's pair-restricted `var_a`
`0.00017266119452185244984350376253074614116717932830619` as if it were `AAA`'s own diagonal,
giving the wrong figures `"33.7947"`/`"66.2053"`. The implementer who actually computed both
numbers from the specified rule, rather than trusting this contract's arithmetic blindly,
caught exactly this discrepancy before writing any code, rather than silently implementing a
mismatched reference — flagged back, verified independently against the corrected rule, and
this section rewritten with the right figures before implementation proceeded.)

### 6.5 What this addendum does not do

Does not use one shared date grid across every held security (each pairwise covariance keeps
its own common-day window, the same simplification section 4 already made). Does not convert
to a volatility-based (rather than variance-based) decomposition. Does not add `POST
/risk/scenarios`. Does not change `build_allocation_response`, `build_portfolio_response`,
`performance_service.py`, or `sector_classifier.py` — every read in this module remains a
black-box call or a small, self-contained new query.
