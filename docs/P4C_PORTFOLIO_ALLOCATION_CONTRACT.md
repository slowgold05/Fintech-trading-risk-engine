# Portfolio allocation by security and sector — contract

Roadmap Phase 4.1 item: "Portfolio allocation by security and sector," with a named route in
section 4.5: `GET /portfolio/allocation` ("Security/sector weights and cash"). Written before
implementation.

This closes the last explicitly-named Phase 4.1 roadmap checklist item. Discovery note: an
earlier backlog entry assumed sector allocation was blocked on "a sector-taxonomy decision" —
that assumption was wrong. `app/services/sector_classifier.py` already exists: a ~500-symbol
S&P 500 static `SECTOR_BY_SYMBOL` map plus a `KEYWORD_SECTORS` regex fallback over a company
name, exposed as `infer_sector(symbol, company_name, existing_sector)`, already used by
`GET /market/symbols` (`app/routers/market.py`). This unit reuses that existing classifier; it
does not invent a new taxonomy.

## Scope

A new route, `GET /portfolio/allocation`, backed by a new service module,
`app/services/portfolio_allocation.py` — **not** a modification to `portfolio_valuation.py` or
`performance_service.py`. It reuses `build_portfolio_response`'s existing valuation (one call,
same single-query valuation path, not a second independent price-fetch) and adds one small,
separate query against `MarketSymbol` for `company_name`/`sector` of the held symbols only —
the same two columns `GET /market/symbols` already reads with `infer_sector`.

Out of scope: a new `GET /portfolio/attribution` or `GET /portfolio/risk-metrics` route (both
named in the same roadmap section 4.5 list, both separate, larger units — risk metrics in
particular need their own contract). No configurable sector taxonomy. No frontend rendering.

## Response shape

```
{
  "user": {"id": ..., "email": ...},
  "read_at": <iso>,
  "status": "complete" | "incomplete",
  "cash_balance": "1000.00",
  "cash_weight_pct": "62.5000" | null,
  "total_account_value": "1600.00" | null,
  "unavailable_symbols": [...],
  "securities": [
    {"symbol": "AAPL", "sector": "Technology", "position_value": "300.00" | null,
     "weight_pct": "18.7500" | null, "price_status": "available" | "unavailable"},
    ...
  ],
  "sectors": [ {"sector": "Technology", "value": "300.00", "weight_pct": "18.7500"}, ... ] | null
}
```

`securities` preserves the same symbol ordering `build_portfolio_response`'s own `positions`
list already uses (ascending by symbol). `sector` is `infer_sector(symbol, company_name,
market_symbol.sector)`; when that returns `None` (no static mapping and no keyword match), the
security is bucketed under `"Other"` — the same catch-all bucket `sector_classifier.SECTOR_ORDER`
already defines. `sectors` is ordered by `SECTOR_ORDER` (imported, not re-derived) and only
includes sectors that actually have at least one currently-held, priced position; a sector with
zero weight is simply absent from the list, not present with `"0.0000"`.

## Status and the all-or-nothing weight rule

`status` mirrors the underlying valuation's `valuation_status` from
`build_portfolio_response`. When `status == "incomplete"` (one or more held positions has an
unavailable price), **every** weight field is `null` — `cash_weight_pct`,
`total_account_value`, every security's `weight_pct`, and `sectors` itself (the whole list, not
a partial one restricted to the priced subset). This follows the roadmap's own acceptance
criterion directly: "Missing or insufficient market history produces an explicit unavailable
result rather than a misleading estimate." A set of percentages that doesn't actually sum to
`100%` (because one holding's value was silently dropped) is exactly the kind of misleading
estimate this guards against. `securities[].position_value` and `price_status` still come
through unchanged from the underlying valuation (a caller can see *which* symbol is missing and
why), only the weight percentages are withheld.

When `status == "complete"`, every weight is computed with `total_account_value` (cash plus
every priced security's value) as the single denominator:

```
cash_weight_pct = cash_balance / total_account_value * 100
security.weight_pct = security.position_value / total_account_value * 100
sector.value = sum of position_value for every held security classified into that sector
sector.weight_pct = sector.value / total_account_value * 100
```

Every percentage quantized to 4 decimal places, `ROUND_HALF_UP` — the same precision
`drawdown_pct`/`realized_pnl_pct` already use elsewhere in this codebase. `sector.value`
quantized to cents like every other dollar amount.

## Reference (independently verified, not derived from the implementation)

Cash `$1000.00`; three priced holdings: `AAPL` (`Technology`) value `$300.00`, `JPM`
(`Financials`) value `$200.00`, `XOM` (`Energy`) value `$100.00`. `total_account_value =
$1600.00`.

```
cash_weight_pct = 1000.00 / 1600.00 * 100 = "62.5000"
AAPL.weight_pct  =  300.00 / 1600.00 * 100 = "18.7500"
JPM.weight_pct   =  200.00 / 1600.00 * 100 = "12.5000"
XOM.weight_pct   =  100.00 / 1600.00 * 100 =  "6.2500"
sectors: [{"Technology", "300.00", "18.7500"}, {"Financials", "200.00", "12.5000"},
          {"Energy", "100.00", "6.2500"}]
```

Chosen deliberately so `cash_weight_pct` plus every security's `weight_pct` sums to exactly
`"100.0000"` — an explicit, checkable property, not a coincidence of these particular numbers
(verified independently with a standalone script before implementation, not derived from the
code under test).

A cash-only account (no holdings): `cash_weight_pct = "100.0000"`, `securities = []`,
`sectors = []` (not `null` — the account's valuation is `complete`, there are simply zero
sectors to report, which is a different state than "unknown because incomplete").

## What this unit does not do

Does not add `GET /portfolio/attribution` or `GET /portfolio/risk-metrics` (separate, later
Phase 4.2 units). Does not add a configurable sector taxonomy or change
`sector_classifier.py`'s existing classification logic. Does not add frontend rendering. No
merge or deploy is claimed by writing this contract.
