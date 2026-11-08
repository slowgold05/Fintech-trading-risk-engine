# Trade Impact Preview (first slice) — contract

Roadmap Phase 4.3: "Trade Impact Preview," named "one of the signature features." Section 4.5's
API list: `POST /portfolio/trade-impact`. The roadmap's own illustrative table shows five
before/after rows (symbol allocation, sector exposure, portfolio volatility, 95% one-day VaR,
buying power) — this is a large surface. This contract scopes a **first slice**, the same way
`GET /portfolio/risk-metrics` shipped nine metrics one at a time (PRs #45, #47-#52). Written
before implementation.

## Scope of this slice

Dollar-and-weight impact only: cash, the traded symbol's position value and weight, cash
weight, and total account value, before and after a hypothetical single trade. **Not** in this
slice: portfolio volatility impact, VaR impact, or sector-exposure impact (each needs its own
contract once this slice's wiring is proven; they would layer on top of
`GET /portfolio/risk-metrics`'s and `GET /portfolio/allocation`'s own already-shipped
computations the same way this slice itself reuses them).

A new, isolated module, `app/services/trade_impact.py`, and a new route,
`POST /portfolio/trade-impact`. Reuses `build_portfolio_response` and
`build_allocation_response` as black boxes — **does not modify either**, and, critically,
**never writes to the database**: no `Order`, `Trade`, `Holding`, or `LedgerEntry` row is
created, and no existing row is mutated. The roadmap's own words: "The preview must never
mutate cash, holdings, or orders."

## Request shape

```
POST /portfolio/trade-impact
{"symbol": "AAPL", "side": "buy" | "sell", "quantity": "2.000000",
 "reference_price": "100.000000", "order_type": "market" | "limit"}
```

Same validation convention `app/schemas/order.py`'s existing `OrderCreate` already uses for the
equivalent fields: `quantity` and `reference_price` are both `Decimal`, `gt=0`, `max_digits=18`,
`decimal_places=6`; `symbol` normalized to uppercase, 1-20 characters; `side` and `order_type`
are closed string enums. Unlike the live `OrderCreate`, `reference_price` is **always**
required regardless of `order_type` — a preview needs a price to value the hypothetical trade
even when previewing a market order (the roadmap explicitly lists "proposed reference price" as
an input alongside order type, not conditional on it).

## Computation

Let `symbol`, `side`, `quantity`, `reference_price` be the request. Read `allocation =
build_allocation_response(db, user_id, email)` once (this already gives cash, every held
symbol's `position_value`/`weight_pct`/`sector`, and `total_account_value`).

If `allocation["status"] != "complete"` (any other currently-held position is unpriced,
independent of the symbol being traded): the response's `status` is `"incomplete"`. The rule is
precise, not "null everything": a field is `null` **exactly when its own computation needs
`total_account_value`**, and populated otherwise, since several fields genuinely do not need
it:

- `before.cash_balance`, `before.buying_power`, `after.cash_balance`, `after.buying_power`,
  `changes.cash_balance`: always computable from `cash_before`/`trade_value` alone — **never**
  `null`, even in the incomplete case.
- `before.symbol_position_value`, `after.symbol_position_value`: computable whenever the
  *traded* symbol itself is priced, regardless of some *other* holding's price being unknown —
  matching `GET /portfolio/allocation`'s own `securities[].position_value` behavior (dollar
  amounts pass straight through independent of the overall `status`), which
  `before.symbol_position_value` is read from directly.
- `changes.total_account_value`: **always `"0.00"`**, even in the incomplete case — this is a
  *relative* invariant (the cash leg and position leg cancel exactly, see below), true
  regardless of whether the absolute `total_account_value` itself is known.
- `before.total_account_value`, `after.total_account_value`, `before.cash_weight_pct`,
  `after.cash_weight_pct`, `before.symbol_weight_pct`, `after.symbol_weight_pct`,
  `changes.cash_weight_pct`, `changes.symbol_weight_pct`: these are the only fields that
  genuinely require the full, unpriced-free valuation to compute — these, and only these, are
  `null` in the incomplete case, the same all-or-nothing principle every other unit in this
  session has already applied for an analogous reason (a weight computed while silently
  ignoring an unpriced position's unknown value would misstate every other percentage).

`warnings` is always evaluated, incomplete case included — it depends only on `cash_before` and
the held share count, neither of which requires the overall valuation to be complete.

Otherwise (`status: "complete"`):

```
cash_before = allocation["cash_balance"]
position_before = the traded symbol's position_value from allocation["securities"], or "0.00"
  if the symbol is not currently held at all
trade_value = quantity * reference_price           (always positive)
cash_after  = cash_before - trade_value   (buy)   |   cash_before + trade_value   (sell)
position_after = position_before + trade_value    (buy)   |   position_before - trade_value (sell)
total_after = allocation["total_account_value"]
            + (cash_after - cash_before) + (position_after - position_before)
            (the two legs cancel exactly — total_after == total_before always;
            see "An invariant worth stating explicitly" below. Do not write this as
            total_before + cash_after - cash_before alone: that omits the offsetting
            position leg and would be wrong by exactly trade_value.)
cash_weight_after = cash_after / total_after * 100
symbol_weight_after = position_after / total_after * 100
```

Neither `position_after` nor `symbol_weight_after` is clamped at zero — a value that goes
negative (an oversell the live engine would reject) is reported as a real negative number, the
same "show what the numbers would be" principle the warnings section below states explicitly.
A full sell to exactly zero already lands on `"0.00"`/`"0.0000"` from the arithmetic with no
special-casing needed.

Every dollar amount quantized to cents, every weight percentage to 4 decimal places,
`ROUND_HALF_UP` — the exact conventions `portfolio_allocation.py` already uses for the same two
kinds of numbers (this slice reuses that module's own quantization constants/style, not a new
convention). `buying_power` is simply `cash_balance` in this paper-trading model (no margin, no
separate buying-power ledger) — `before.buying_power == before.cash_balance` and
`after.buying_power == after.cash_balance` always, by construction, in this slice.

**An invariant worth stating explicitly, and checked directly in the reference test:**
`total_account_value` is **unchanged** by a trade at exactly the quoted `reference_price` — a
dollar of cash converts to a dollar of position value (buy) or back (sell) with no assumed
slippage, fee, or spread in this preview. `changes.total_account_value` is therefore always
`"0.00"` in this slice. A later slice could introduce a modeled spread/fee if ever needed; this
one does not.

## Warnings — informational, not a rejection

The preview always computes and returns a result (per the roadmap's own "non-binding" framing);
it never 422s solely because the hypothetical trade looks infeasible. Instead, a `warnings`
list (possibly empty) flags exactly two conditions:

- `"insufficient_buying_power"`: `side == "buy"` and `trade_value > cash_before`.
- `"insufficient_shares"`: `side == "sell"` and `quantity` exceeds the symbol's currently held
  share count (read from `build_portfolio_response`'s own `positions[].quantity`, the one field
  `build_allocation_response` does not itself expose — this is the one place this unit reads
  `build_portfolio_response` directly rather than only through `build_allocation_response`).

The computation proceeds identically whether or not a warning fires — the numbers above are
computed the same way regardless, including a case that goes `cash_after < 0`. This is
deliberate: the preview shows what the numbers *would be*, and the warning is the signal that
the actual order would be rejected at execution time, consistent with "execution-time
validation remains authoritative," which this preview explicitly is not.

## Response shape

```
{
  "user": {"id": ..., "email": ...},
  "read_at": <iso>,
  "status": "complete" | "incomplete",
  "symbol": "AAPL", "side": "buy", "quantity": "2.000000",
  "reference_price": "100.000000", "order_type": "market",
  "warnings": [],
  "before": {"cash_balance": "1000.00", "buying_power": "1000.00",
             "total_account_value": "1600.00" | null, "cash_weight_pct": "62.5000" | null,
             "symbol_position_value": "300.00", "symbol_weight_pct": "18.7500" | null},
  "after":  {"cash_balance": "800.00", "buying_power": "800.00",
             "total_account_value": "1600.00" | null, "cash_weight_pct": "50.0000" | null,
             "symbol_position_value": "500.00", "symbol_weight_pct": "31.2500" | null},
  "changes": {"cash_balance": "-200.00", "total_account_value": "0.00" | null,
              "cash_weight_pct": "-12.5000" | null, "symbol_weight_pct": "12.5000" | null}
}
```

`before.symbol_position_value`/`after.symbol_position_value` are never `null` whenever the
traded symbol itself is priced — `"0.00"` for a not-currently-held symbol before a buy, or for
the position after a full sell — in **both** the `"complete"` and `"incomplete"` cases (see the
precise field-by-field incomplete-case rule above); only the fields that genuinely need
`total_account_value` are ever `null`.

## Reference (independently verified, not derived from the implementation)

Reuses `GET /portfolio/allocation`'s own already-independently-verified fixture: cash
`$1000.00`, `AAPL` `$300.00`, `JPM` `$200.00`, `XOM` `$100.00`, `total_account_value =
$1600.00`. Preview: **buy 2 shares of `AAPL`** at `reference_price = "100.000000"`.

```
trade_value = 2 * 100.000000 = 200.00
cash_after = 1000.00 - 200.00 = 800.00
position_after (AAPL) = 300.00 + 200.00 = 500.00
total_after = 1600.00 (invariant - see above)
cash_weight_pct: before = 1000.00/1600.00*100 = "62.5000", after = 800.00/1600.00*100 = "50.0000"
symbol_weight_pct: before = 300.00/1600.00*100 = "18.7500", after = 500.00/1600.00*100 = "31.2500"
changes: cash_balance = "-200.00", total_account_value = "0.00",
         cash_weight_pct = "-12.5000", symbol_weight_pct = "12.5000"
warnings = []  (cost 200.00 <= cash_before 1000.00)
```

A second reference, **sell 1 share of `AAPL`** at the same `reference_price`, from the same
baseline:

```
trade_value = 1 * 100.000000 = 100.00
cash_after = 1000.00 + 100.00 = 1100.00
position_after (AAPL) = 300.00 - 100.00 = 200.00
cash_weight_pct: after = 1100.00/1600.00*100 = "68.7500"
symbol_weight_pct: after = 200.00/1600.00*100 = "12.5000"
warnings = []  (AAPL is held with 3 shares at $100 each in this fixture, so 1 share is available)
```

A third reference demonstrating the incomplete-case field-by-field rule: same fixture, except
`JPM` (a different holding) has no quote at all, so `allocation["status"] == "incomplete"`.
Preview **buy 2 shares of `AAPL`** at `reference_price = "100.000000"` (the same trade as the
first reference above):

```
status = "incomplete"
before = {"cash_balance": "1000.00", "buying_power": "1000.00",
          "total_account_value": null, "cash_weight_pct": null,
          "symbol_position_value": "300.00", "symbol_weight_pct": null}
after  = {"cash_balance": "800.00", "buying_power": "800.00",
          "total_account_value": null, "cash_weight_pct": null,
          "symbol_position_value": "500.00", "symbol_weight_pct": null}
changes = {"cash_balance": "-200.00", "total_account_value": "0.00",
           "cash_weight_pct": null, "symbol_weight_pct": null}
warnings = []
```

`AAPL`'s own dollar figures (`symbol_position_value`, `cash_balance`) and the known-invariant
`changes.total_account_value` are populated exactly as if the valuation were complete — only
the four fields that genuinely require the unpriced-free `total_account_value` (both totals,
both weight percentages, and their two `changes`) are `null`. `JPM`'s own unpriced status never
enters this computation at all, since this preview only ever reads the one traded symbol's own
position.

## What this unit does not do

Does not add portfolio-volatility or VaR impact (both named in the roadmap's own illustrative
table — separate, later units once this wiring is proven). Does not add sector-exposure
before/after (also in that table — would reuse `GET /portfolio/allocation`'s own `sectors`
list, a natural next slice). Does not persist anything, does not touch `Order`/`Trade`/
`Holding`/`LedgerEntry`, does not call the live order-matching engine, does not model slippage,
fees, or a bid/ask spread. Does not change `build_portfolio_response` or
`build_allocation_response`. No frontend rendering. No merge or deploy is claimed.
