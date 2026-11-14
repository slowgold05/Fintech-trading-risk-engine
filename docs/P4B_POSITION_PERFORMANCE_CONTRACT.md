# Performance by position/asset — contract

Roadmap Phase 4.1 item: "Performance by position/asset." Written before implementation.

This is a separate unit from `docs/P4A_PERFORMANCE_CONTRACT.md` (the `GET /portfolio/performance`
daily series route). It extends the existing `GET /portfolio/` response
(`app/services/portfolio_valuation.py`), which already returns, per currently-held position,
`unrealized_pnl`/`unrealized_pnl_pct`/`cost_basis`/`position_value` — the piece missing is a
**per-position realized P&L** and a **per-position combined total P&L**. The account-wide
`total_realized_pnl` already exists in `summary`; this adds the breakdown by asset that produces
that total.

## Scope

In scope: two new fields on each entry in the existing `positions` list — `realized_pnl` and
`total_pnl`. Both are for **currently held** positions only (the same `Holding.quantity != 0`
join the route already uses). A position that was fully closed out (quantity now zero) is not
in the `positions` list today and stays that way — this unit does not add a separate "closed
positions" list or change which positions appear.

Out of scope: a dedicated "performance by asset" summary table that aggregates by `asset_type`
(stock vs crypto) or by sector — sector allocation is its own, separate Phase 4.1 roadmap item,
not folded into this one. No frontend rendering.

## `realized_pnl` per position

```
realized_pnl(asset_id) = sum of Trade.realized_pnl where Trade.user_id = user,
                          Trade.asset_id = asset_id, Trade.side = "sell",
                          Trade.id in trades-after-the-latest-reset
```

Exactly the same latest-`reset`-boundary rule `_realized_subquery` already applies
account-wide (`app/services/portfolio_valuation.py`), just filtered to one asset. Compute it as
one grouped query over all the account's assets (`GROUP BY Trade.asset_id`), not one query per
position — reuse the existing boundary subquery's `latest_reset_id`/`trades_after_reset` shape.

This field is **never null** for a currently-held position — a position that has never been
sold has `realized_pnl = "0.00"` (a real, measured zero: nothing has been sold, which is a known
fact, not an unknown one). Quantize to cents, `ROUND_HALF_UP`, same as every other dollar field
in this file.

Sum of every position's `realized_pnl` plus whatever a fully-closed-out position would have
contributed need not equal `summary.total_realized_pnl` — the summary total is account-wide
across every asset ever traded (including ones no longer held), while the per-position field is
only computed for currently-held assets. This unit does not reconcile the two; it does not claim
they are equal. (Document this explicitly rather than let it look like a missed invariant.)

## `total_pnl` per position

```
total_pnl(position) = realized_pnl(asset_id) + unrealized_pnl    if price is available
                     = null                                       if price is unavailable
```

`unrealized_pnl` is already computed by the existing loop and is `null` exactly when
`price_status != "available"`. `total_pnl` follows that same nullability — it is never a
different null/non-null state than `unrealized_pnl` is for the same position, since
`realized_pnl` itself is never null. Quantize to cents, `ROUND_HALF_UP`.

## Reference (independently verified, reusing the existing fixture's own numbers)

From the already-shipped `test_complete_two_position_marks_and_empty_book` fixture (cash
$1000.00; AAPL qty 2 @ avg cost $10, one sell trade with `realized_pnl = 12.34`, current price
$100.25; MSFT qty 1.5 @ avg cost $40, no sells, current price $10.10):

```
AAPL: realized_pnl = "12.34"   (the one recorded sell)
      unrealized_pnl = "180.50" (already asserted today)
      total_pnl = "192.84"      (12.34 + 180.50)

MSFT: realized_pnl = "0.00"    (never sold — a real zero, not null)
      unrealized_pnl = "-44.85" (already asserted today)
      total_pnl = "-44.85"      (0.00 + -44.85)
```

From the already-shipped `test_missing_price_is_200_compatibility_change` fixture (AAPL same
sell as above, price available; MISS/BAD/NEG/OLD/BTC all with no trades, price unavailable for
every reason):

```
AAPL: realized_pnl = "12.34", unrealized_pnl = "180.50" (already asserted), total_pnl = "192.84"
MISS, BAD, NEG, OLD, BTC: realized_pnl = "0.00" (never sold), total_pnl = null (price unavailable)
```

## Reset-boundary reference (a new, dedicated test — not derivable from the two fixtures above)

Asset XYZ, qty 10 @ avg cost $50, current price $60 (unrealized = `10 * 60 - 10 * 50 = "100.00"`
if nothing else changes it — adjust quantity/avg_cost in the actual test to whatever the pre/
post-reset trades leave the `Holding` row at; the point under test is `realized_pnl`, not
`unrealized_pnl`):

1. A sell trade on XYZ recorded **before** a reset, `realized_pnl = "999.00"`.
2. `append_reset(db, user, target_cash)` (the existing helper, same one
   `test_reset_is_the_same_inception_boundary_as_realized_pnl` in
   `tests/test_portfolio_performance.py` already uses).
3. A second sell trade on XYZ recorded **after** the reset, `realized_pnl = "25.00"`.

Expected: `positions` entry for XYZ has `realized_pnl == "25.00"` — the pre-reset `"999.00"`
trade must not be counted, proving the per-asset grouped query applies the same boundary
subquery the account-wide total already uses, not a naive sum of every `Trade` row for that
asset. (Independently verified: `25.00`, not `1024.00` and not `999.00`.)

## What this unit does not do

Does not add performance-by-asset-type or sector-level aggregation (separate roadmap items).
Does not change `summary.total_realized_pnl`'s existing account-wide meaning. Does not add a
closed-positions list. No frontend rendering. No merge or deploy is claimed by writing this
contract.
