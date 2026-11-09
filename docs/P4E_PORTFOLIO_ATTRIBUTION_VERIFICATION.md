# Portfolio P&L attribution verification

Adds `GET /portfolio/attribution` — the last remaining named route from the roadmap's section
4.5 API list (every other route there — `/performance`, `/allocation`, `/risk-metrics` — is now
shipped). Design written first as `docs/P4E_PORTFOLIO_ATTRIBUTION_CONTRACT.md`. This is dollar
P&L attribution, distinct from `GET /portfolio/risk-metrics`'s `risk_contributions` (variance
attribution, PR #52) — the two answer different questions and share no implementation.

## Implemented by Grok, independently verified by me

A new module, `app/services/portfolio_attribution.py` (structurally an almost-exact sibling of
`portfolio_allocation.py`), and one new route. `portfolio_valuation.py`,
`performance_service.py`, `portfolio_allocation.py`, `portfolio_risk.py`, and
`sector_classifier.py` are all byte-identical to before this change. No new P&L arithmetic —
every position's `realized_pnl`/`unrealized_pnl`/`total_pnl` is read straight from the existing,
already-shipped `build_portfolio_response` fields (PR #42).

- Correctly implements the two distinct null cases the contract draws apart: an **incomplete**
  valuation nulls `total_pnl`/`sectors`/every `pnl_contribution_pct` (one or more unpriced
  position, an unknown-information case), versus a **complete** valuation whose net `total_pnl`
  happens to be exactly `"0.00"`, which still reports that real zero but nulls every percentage
  only because dividing by zero is undefined — a different reason for the same null value, both
  correctly tested separately.
- Correctly does **not** clamp `pnl_contribution_pct` to `[0, 100]` — the explicit test
  (`test_a_position_contributing_more_than_the_whole_can_exceed_one_hundred_percent`) proves
  this against the real route, not just the hardcoded reference numbers, by checking the
  property (`> 100` or `< 0`) generically across every security/sector entry.
- A sector that happens to net to exactly zero while the whole-account total is non-zero still
  gets a real `"0.0000"` (not `null`) — correctly distinguished in code from the whole-response
  zero-total null case (verified by `_sector_payloads`'s `percentages_defined` flag being
  passed in from the caller, not re-derived per-sector).

## Independent verification

- Re-derived the contract's own reference (`AAPL` `total_pnl = "192.84"`, `MSFT` `total_pnl =
  "-44.85"`, net `"147.99"`) in a separate script before review: `130.3061%`/`-30.3061%`,
  summing to exactly `"100.0000"`. Matched exactly.
- Reviewed the full diff/new files directly (not Grok's self-report).
- `python -m pytest -q tests/test_portfolio_attribution.py`: **4 passed** (all new).
- `python -m pytest -q` (full backend suite): **394 passed, 28 skipped**, the same 2
  pre-existing unrelated Windows-local SQLite-locking errors (documented since PR #27).
- Confirmed `portfolio_valuation.py`, `performance_service.py`, `portfolio_allocation.py`,
  `portfolio_risk.py`, and `sector_classifier.py` are byte-identical (empty `git diff --stat`
  on all five) — this unit only reads them.

## What changed

- `app/services/portfolio_attribution.py`: new module, `build_attribution_response`.
- `app/routers/portfolio.py`: new `GET /attribution` route, mirroring the existing routes'
  shape exactly.
- `tests/test_portfolio_attribution.py`: new file, 4 tests.
- `docs/P4E_PORTFOLIO_ATTRIBUTION_CONTRACT.md`: new contract, written by me before
  implementation, untouched by Grok.

## What this unit does not do

Does not add a time-series attribution view (how contribution evolved day by day) — a single,
current-snapshot breakdown only, the same point-in-time nature `GET /portfolio/allocation`
already has. Does not duplicate `GET /portfolio/risk-metrics`'s variance-based
`risk_contributions`. No frontend rendering. No merge or deploy is claimed.

With this unit, every route named in the roadmap's section 4.5 API list
(`/performance`, `/allocation`, `/attribution`, `/risk-metrics`) is shipped; `POST
/portfolio/trade-impact` (Phase 4.3) and `POST /risk/scenarios` (Phase 4.4's full custom-shock
Risk Lab) remain open, unstarted.
