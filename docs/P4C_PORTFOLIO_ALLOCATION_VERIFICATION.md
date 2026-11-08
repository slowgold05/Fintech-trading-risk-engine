# Portfolio allocation verification

Adds `GET /portfolio/allocation` — the exact route the roadmap's section 4.5 API list names
("Security/sector weights and cash"). Closes the last explicitly-named Phase 4.1 checklist
item, "Portfolio allocation by security and sector." Design written first as
`docs/P4C_PORTFOLIO_ALLOCATION_CONTRACT.md`. Correction worth recording: an earlier backlog note
(before this unit) assumed sector allocation was blocked on "a sector-taxonomy decision" — that
was wrong. `app/services/sector_classifier.py` already existed (a ~500-symbol static map plus a
keyword fallback, already used by `GET /market/symbols`); this unit reuses it rather than
inventing a new taxonomy.

## Implemented by Grok, independently verified by me

A new module, `app/services/portfolio_allocation.py`, and a new route in
`app/routers/portfolio.py` — neither `portfolio_valuation.py`, `performance_service.py`, nor
`sector_classifier.py` was touched (confirmed with `git diff --stat`, empty output on all
three). `build_allocation_response` calls the existing `build_portfolio_response` once as a
black box, reads its `summary`/`positions`, then does exactly one additional query
(`MarketSymbol.symbol.in_(<held symbols>)`) for `company_name`/`sector` lookups — not one query
per symbol. Correctly implemented the "all-or-nothing" rule: when the underlying valuation's
`total_account_value` is `None`, every weight field — `cash_weight_pct`,
`total_account_value`, every security's `weight_pct`, and `sectors` itself — is `null`, while
`securities[].position_value`/`price_status`/`sector` still pass through (sector classification
never depends on price). Sector classification happens identically whether the valuation is
complete or not — a single `_classified_positions` helper, not two separate code paths that
could diverge. Grouped sector totals correctly skip a zero-total sector rather than emitting a
`"0.0000"` entry, and sort by `SECTOR_ORDER`'s own rank (imported, not re-derived).

The reference test (`test_three_sector_reference_vector`) includes a genuinely useful
self-check beyond matching the contract's hardcoded numbers: it asserts the stored
`MarketSymbol.sector` column is actually `None` for `AAPL` in that test, proving the result came
from `SECTOR_BY_SYMBOL`'s static map (via `infer_sector`'s fallback order), not from a seeded
`MarketSymbol.sector` value that would have made the test pass for the wrong reason. It also
computes the sum of `cash_weight_pct` plus every security's `weight_pct` from the live response
and asserts it equals exactly `Decimal("100.0000")` — a genuine property check, not a duplicate
hardcoded number. A fourth test, `test_unmapped_symbol_falls_back_to_other`, confirms a symbol
with no `MarketSymbol` row at all and no `SECTOR_BY_SYMBOL` entry falls back to `"Other"`.

Independent verification: re-derived the three-sector reference (`cash $1000, AAPL $300, JPM
$200, XOM $100`, total `$1600`) in a separate script before review —
`62.5000/18.7500/12.5000/6.2500` matched exactly. Confirmed `MarketSymbol`, `Asset`, and
`sector_classifier.SECTOR_ORDER`/`infer_sector` signatures by reading the actual source before
trusting the test's usage of them.

- `python -m pytest -q tests/test_portfolio_allocation.py`: **4 passed** (all new).
- `python -m pytest -q` (full backend suite): **368 passed, 28 skipped**, 2 pre-existing
  unrelated Windows-local SQLite-locking errors documented since PR #27.
- No file outside `app/services/portfolio_allocation.py` (new), `app/routers/portfolio.py`
  (one added route), and `tests/test_portfolio_allocation.py` (new) was touched.

## What changed

- `app/services/portfolio_allocation.py`: new module, `build_allocation_response`.
- `app/routers/portfolio.py`: new `GET /allocation` route, mirroring the existing `/` and
  `/performance` routes' shape exactly.
- `tests/test_portfolio_allocation.py`: new file, 4 tests.
- `docs/P4C_PORTFOLIO_ALLOCATION_CONTRACT.md`: new contract, written by me before
  implementation, untouched by Grok.

## What this unit does not do

Does not add `GET /portfolio/attribution` or `GET /portfolio/risk-metrics` (separate, larger
Phase 4.2 units, not scoped here). Does not add a configurable sector taxonomy or change
`sector_classifier.py`'s existing logic. No frontend rendering. No merge or deploy is claimed.
