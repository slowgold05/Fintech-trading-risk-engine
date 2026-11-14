# Custom risk scenarios — contract

Roadmap Phase 4.4 "Risk Lab" and section 4.5's named route: `POST /risk/scenarios`. Distinct
from the fixed, three-scenario `stress_scenarios` already shipped inside
`GET /portfolio/risk-metrics` (PR #51) — this is the **custom** scenario builder the roadmap's
own Risk Lab examples call out: "Custom simultaneous security or sector shocks," generalizing
the same revaluation idea to user-supplied shocks instead of three fixed ones. Written before
implementation.

## Scope of this slice

Symbol-level and sector-level shocks only (`target_type: "symbol" | "sector"`) — the roadmap's
own wording for the custom case is specifically "security or sector," not a third
broad-market/"all" option (that case is already covered by the existing fixed
`broad_market_selloff` scenario). Interest-rate shock assumptions and historical crisis-style
scenarios (both also named in the Risk Lab's example list) are **not** in this slice — they
need their own factor model or historical-window replay respectively, neither of which this
unit builds.

A new, isolated module, `app/services/risk_scenarios.py`, and a new route,
`POST /risk/scenarios`. Reuses `build_allocation_response` as a black box (the same reuse
pattern `trade_impact.py` and the fixed `stress_scenarios` helper inside `portfolio_risk.py`
both already established) — does **not** modify `portfolio_allocation.py`,
`portfolio_valuation.py`, or `portfolio_risk.py`. Never writes to the database — a pure
read-only preview, the same "never mutate" principle `POST /portfolio/trade-impact` already
established.

## Request shape

```
POST /risk/scenarios
{"shocks": [
  {"target_type": "symbol", "target": "AAPL", "shock_pct": "-10.0000"},
  {"target_type": "sector", "target": "Energy", "shock_pct": "-20.0000"}
]}
```

`shocks` is a list of 1 to 20 entries (an arbitrary but generous upper bound, purely to reject a
pathological request body, not a meaningful business rule). Each `shock_pct` is `Decimal`,
`max_digits=18`, `decimal_places=4`, and must be strictly greater than `-100` (a shock of
exactly or beyond `-100%` would zero out or invert a position's value, which is not a
meaningful "shock" for a long-only paper-trading position) — reject with `422` otherwise.
`target_type` is a closed two-value enum; `target` is a plain string (a symbol or a sector
name — not validated against the real symbol/sector universe at the request-schema level,
since an unmatched target simply affects zero positions, a legitimate and harmless outcome, not
an error).

## Computation

Call `allocation = build_allocation_response(db, user_id, email)` once. If
`allocation["status"] != "complete"`, the response's `status` is `"incomplete"` and every
dollar/percentage field is `null` except the echoed-back `shocks` list itself (the same
all-or-nothing principle every other unit in this session has already applied — a scenario
revaluation while silently ignoring an unpriced position's unknown value would misstate the
result).

Otherwise, for each priced security in `allocation["securities"]`, apply every shock whose
`target_type`/`target` matches that security (`target_type == "symbol"` and `target ==
security.symbol`, or `target_type == "sector"` and `target == security.sector`) —
**multiplicatively, in the order the shocks were given in the request**, not summed:

```
position_value_after = position_value_before
for shock in shocks:
    if shock matches this security:
        position_value_after *= (1 + shock.shock_pct / 100)
```

This is a deliberate, explicit choice over summing percentages: summing two `-60%` shocks on
the same position would produce a nonsensical `-120%` (implying a negative position value);
applying them multiplicatively (`0.4 * 0.4 = 0.16`, a `-84%` combined effect) always keeps the
result in a sane range and matches how sequential, independent percentage shocks compose in
real markets. Quantized to cents after all matching shocks for that security have been applied
(one quantization per security, not one per shock, to avoid compounding rounding error).

`total_account_value_after = cash_balance + sum(every security's position_value_after)` (cash
is never shocked, the same convention `GET /portfolio/risk-metrics`'s fixed scenarios already
established). `loss = total_account_value_before - total_account_value_after` (positive means a
loss; a scenario with only positive `shock_pct` values can produce a negative `loss`, i.e. a
gain — this endpoint does not assume every custom scenario is a stress test in the "always a
loss" sense, unlike the fixed three scenarios, which are all hardcoded to a negative
direction). `loss_pct = loss / total_account_value_before * 100`.

## Response shape

```
{
  "user": {...}, "read_at": <iso>, "status": "complete" | "incomplete",
  "shocks": [...the request's own shocks, echoed back...],
  "total_account_value_before": "1600.00" | null,
  "total_account_value_after": "1550.00" | null,
  "loss": "50.00" | null,
  "loss_pct": "3.1250" | null,
  "securities": [
    {"symbol": "AAPL", "sector": "Technology", "position_value_before": "300.00",
     "position_value_after": "270.00"},
    ...
  ]
}
```

`securities` lists every currently-held, priced security (the same ordering
`build_allocation_response`'s own `securities` list already uses), each with its before/after
dollar value — present even for a security no shock matched (`position_value_before ==
position_value_after` in that case, a real, unchanged value, not omitted).

## Reference (independently verified, not derived from the implementation)

Reuses `GET /portfolio/allocation`'s own reference fixture: cash `$1000.00`, `AAPL`
(`Technology`) `$300.00`, `JPM` (`Financials`) `$200.00`, `XOM` (`Energy`) `$100.00`, total
`$1600.00`.

**Reference 1** — two independent shocks, `[{"symbol", "AAPL", "-10.0000"}, {"sector",
"Energy", "-20.0000"}]`:

```
AAPL: 300.00 * 0.90 = 270.00        (only the symbol shock matches)
JPM:  200.00 (unchanged - no shock matches Financials)
XOM:  100.00 * 0.80 = 80.00         (only the sector shock matches)
total_after = 1000.00 + 270.00 + 200.00 + 80.00 = 1550.00
loss = 1600.00 - 1550.00 = 50.00
loss_pct = 50.00 / 1600.00 * 100 = "3.1250"
```

**Reference 2** — the same two shocks, plus a third, `{"sector", "Technology",
"-5.0000"}`, demonstrating the multiplicative combination rule on `AAPL` (matched by both the
symbol shock and the sector shock, applied in the given order):

```
AAPL: 300.00 * 0.90 * 0.95 = 256.50
total_after = 1000.00 + 256.50 + 200.00 + 80.00 = 1536.50
loss = 1600.00 - 1536.50 = 63.50
loss_pct = 63.50 / 1600.00 * 100 = "3.9688"
```

Both independently verified with a standalone `Decimal` script before implementation.

## What this unit does not do

Does not add interest-rate shock assumptions (needs a duration/factor model). Does not add
historical crisis-style scenarios (needs a historical-window replay mechanism). Does not add a
broad-market/"all" target type (already covered by the existing fixed
`broad_market_selloff`). Does not persist a scenario, does not touch
`Order`/`Trade`/`Holding`/`LedgerEntry`. Does not change `build_allocation_response`,
`build_portfolio_response`, or `portfolio_risk.py`. No frontend rendering. No merge or deploy
is claimed by writing this contract.
