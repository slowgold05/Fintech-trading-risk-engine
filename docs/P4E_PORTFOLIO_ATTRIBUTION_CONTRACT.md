# Portfolio P&L attribution by security and sector — contract

Roadmap Phase 4.2 section 4.5's remaining named route: `GET /portfolio/attribution`. With all
nine Phase 4.2 risk metrics now shipped under `GET /portfolio/risk-metrics` (PRs #45, #47-#52),
this route is the last item on that section's own API list still unstarted. Written before
implementation.

## Scope

A new route, `GET /portfolio/attribution`, backed by a new, isolated service module,
`app/services/portfolio_attribution.py` — **not** a modification to `portfolio_valuation.py`,
`performance_service.py`, `portfolio_allocation.py`, or `portfolio_risk.py`. Follows the exact
structural precedent `portfolio_allocation.py` already set: one black-box call to
`build_portfolio_response` (reusing each position's already-published `realized_pnl`/
`unrealized_pnl`/`total_pnl` — all three already shipped by PR #42, no new P&L arithmetic is
introduced here), plus the same sector-classification reuse (`infer_sector`,
`SECTOR_ORDER`) `portfolio_allocation.py` already established.

This is **dollar profit-and-loss attribution**, not the risk-based variance attribution
`GET /portfolio/risk-metrics`'s `risk_contributions` field already provides (PR #52) — a
security can carry a large *risk* share while contributing little to realized/unrealized
*profit*, or vice versa; the two metrics answer different questions and this unit does not
duplicate the other's math.

## Response shape

```
{
  "user": {"id": ..., "email": ...},
  "read_at": <iso>,
  "status": "complete" | "incomplete",
  "total_pnl": "147.99" | null,
  "securities": [
    {"symbol": "AAPL", "sector": "Technology", "realized_pnl": "12.34",
     "unrealized_pnl": "180.50", "total_pnl": "192.84",
     "pnl_contribution_pct": "130.3061" | null},
    {"symbol": "MSFT", "sector": "Technology", "realized_pnl": "0.00",
     "unrealized_pnl": "-44.85", "total_pnl": "-44.85",
     "pnl_contribution_pct": "-30.3061" | null}
  ],
  "sectors": [
    {"sector": "Technology", "total_pnl": "147.99", "pnl_contribution_pct": "100.0000" | null}
  ] | null
}
```

`securities` preserves `build_portfolio_response`'s own `positions` ordering (ascending by
symbol) and includes **every** currently-held position, priced or not — `realized_pnl` is
never null (a position that has never been sold reports a real measured `"0.00"`, the existing
convention `GET /portfolio/` already established), while `unrealized_pnl`/`total_pnl` are
`null` exactly when the position's own `price_status != "available"`, passed straight through
unchanged. `sector` uses the same `infer_sector(...) or "Other"` classification
`portfolio_allocation.py` already applies.

## Status and the all-or-nothing contribution-percentage rule

`status` mirrors `build_portfolio_response`'s own `valuation_status`. When `status ==
"incomplete"` (any held position unpriced), **every** `pnl_contribution_pct` is `null` and
`total_pnl`/`sectors` are both `null` — the same all-or-nothing principle `GET
/portfolio/allocation`'s weights and `GET /portfolio/risk-metrics`'s `stress_scenarios` already
established, for the identical reason: a contribution percentage computed while silently
ignoring an unpriced position's unknown P&L would misstate every other position's share.
`securities[].realized_pnl`/`unrealized_pnl`/`total_pnl`/`sector` still pass through unchanged
in the incomplete case (same transparency precedent).

When `status == "complete"`:

```
total_pnl = sum(position.total_pnl for position in securities)
security.pnl_contribution_pct = security.total_pnl / total_pnl * 100   (when total_pnl != 0)
sector.total_pnl = sum(total_pnl for positions in that sector)
sector.pnl_contribution_pct = sector.total_pnl / total_pnl * 100
```

**A second, narrower null case, distinct from the incomplete-valuation one above:** when
`status == "complete"` but `total_pnl == 0` exactly (gains and losses across every position
happen to net to zero), every `pnl_contribution_pct` is `null` — a percentage of zero is
undefined, not a misleading estimate to guard against, but a genuine mathematical
non-computability the same way `GET /portfolio/risk-metrics`'s `portfolio_variance <= 0` guard
already nulls `risk_contributions` for an analogous reason. `total_pnl` itself still reports
the real `"0.00"` in this case — only the percentages, which cannot be computed, are withheld.

A contribution percentage can legitimately fall **outside** `[0, 100]` — a losing position
contributes a *negative* percentage, and a position whose gain exceeds the account's total net
P&L (because another position is dragging the total down) contributes *more than 100%*. This is
correct, expected behavior for dollar P&L attribution (unlike a weight percentage, which is
always non-negative and bounded by construction) — not a bug to guard against. Every
`pnl_contribution_pct` quantized to 4 decimal places, `ROUND_HALF_UP`, and the full set
(securities plus sectors, each summed independently) always sums to exactly `"100.0000"` when
non-null, the same explicit checkable property `GET /portfolio/allocation`'s weights and
`GET /portfolio/risk-metrics`'s `risk_contributions` both already guarantee.

## Reference (independently verified, not derived from the implementation)

Reuses the exact fixture `GET /portfolio/`'s own already-shipped `total_pnl` field uses (PR
#42): `AAPL` (`Technology`) `realized_pnl = "12.34"`, `unrealized_pnl = "180.50"`, `total_pnl =
"192.84"`; `MSFT` (`Technology`) `realized_pnl = "0.00"`, `unrealized_pnl = "-44.85"`, `total_pnl
= "-44.85"`.

```
total_pnl = 192.84 + (-44.85) = 147.99
pnl_contribution_pct_AAPL = 192.84 / 147.99 * 100 = "130.3061"
pnl_contribution_pct_MSFT = -44.85 / 147.99 * 100 = "-30.3061"
"130.3061" + "-30.3061" == "100.0000" exactly
```

Both `AAPL` and `MSFT` classify as `Technology` in this reference, so there is exactly one
sector entry: `{"sector": "Technology", "total_pnl": "147.99", "pnl_contribution_pct":
"100.0000"}`. Deliberately chosen to demonstrate the out-of-`[0, 100]` property directly in the
primary reference (`AAPL`'s `130.3061%` exceeds 100%, `MSFT`'s `-30.3061%` is negative) rather
than leaving it to a secondary example, since this is the metric's single most
counter-intuitive, most important-to-get-right behavior.

## What this unit does not do

Does not add a per-sector breakdown finer than security→sector grouping (no sub-sector,
industry, or asset-class dimension). Does not compute time-series attribution (how the
contribution evolved day by day) — this is a single, current-snapshot breakdown, the same
"point-in-time" nature `GET /portfolio/allocation` already has, not a new series endpoint. Does
not change `portfolio_valuation.py`, `performance_service.py`, `portfolio_allocation.py`, or
`portfolio_risk.py`. No frontend rendering. No merge or deploy is claimed by writing this
contract.
