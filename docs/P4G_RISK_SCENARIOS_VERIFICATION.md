# Custom risk scenarios verification

Adds `POST /risk/scenarios` — the custom security/sector shock builder named in roadmap Phase
4.4's Risk Lab and section 4.5's API list, distinct from the fixed three-scenario
`stress_scenarios` already shipped inside `GET /portfolio/risk-metrics` (PR #51). Design
written first as `docs/P4G_RISK_SCENARIOS_CONTRACT.md`.

## Implemented by Grok, independently verified by me

A new schema, a new, isolated service module, and one new route added to the existing `/risk`
router (mounted at that prefix in `app/main.py`, so `@router.post("/scenarios")` correctly
becomes `POST /risk/scenarios`). `app/services/portfolio_allocation.py`,
`app/services/portfolio_valuation.py`, and `app/services/portfolio_risk.py` are all
byte-identical to before this change. **No database write occurs anywhere in this route** —
confirmed by the same `_book_fingerprint` pattern (cash, order/trade counts, every holding,
ledger-entry count) the trade-impact preview's own tests already established, taken before and
after the call and asserted identical.

- Matching shocks are correctly applied **multiplicatively, in request order**, with exactly
  one cent-quantization per security after all matching shocks — not one per shock (which
  would compound rounding error) and not summed percentages (which could produce a nonsensical
  result below `-100%`). The combined-shocks test explicitly distinguishes the correct
  multiplicative result (`"256.50"`) from what a naive summed-percentage implementation would
  have produced (`"255.00"`), proving the right arithmetic was actually implemented, not just
  claimed.
- Correctly does not assume every scenario is a loss — a positive `shock_pct` produces a
  negative `loss` (a gain), tested explicitly, matching the contract's own explicit statement
  that this generalized endpoint, unlike the three fixed scenarios, is not hardcoded to a loss
  direction.
- `shocks` is echoed back using the same `format(value, "f")` decimal-text convention every
  other field in this codebase uses — not Pydantic's own default JSON number serialization of
  a `Decimal`, which would have been inconsistent with the rest of the response.

## Independent verification

- Re-derived both of the contract's reference vectors in a separate script before review:
  Reference 1 (`"270.00"`/`"80.00"` → `total_after = "1550.00"`, `loss = "50.00"`, `loss_pct =
  "3.1250"`) and Reference 2 (`"256.50"` → `total_after = "1536.50"`, `loss = "63.50"`,
  `loss_pct = "3.9688"`). Both matched exactly.
- Reviewed the full diff of all four files directly (not Grok's self-report).
- `python -m pytest -q tests/test_risk_scenarios.py`: **5 passed** (all new).
- `python -m pytest -q` (full backend suite): **408 passed, 28 skipped**, the same 2
  pre-existing unrelated Windows-local SQLite-locking errors (documented since PR #27).
- Confirmed `app/services/portfolio_allocation.py`, `app/services/portfolio_valuation.py`, and
  `app/services/portfolio_risk.py` are byte-identical to before this change.

## What changed

- `app/schemas/risk_scenarios.py`: new file, `RiskScenarioShock`/`RiskScenariosRequest`.
- `app/services/risk_scenarios.py`: new file, `build_risk_scenarios_response`.
- `app/routers/risk.py`: new `POST /scenarios` route; existing two routes untouched.
- `tests/test_risk_scenarios.py`: new file, 5 tests.
- `docs/P4G_RISK_SCENARIOS_CONTRACT.md`: new contract, written by me before implementation,
  untouched by Grok.

## What this unit does not do

Does not add interest-rate shock assumptions or historical crisis-style scenarios (both named
in the Risk Lab's example list — each needs its own model, not built here). Does not add a
broad-market/"all" target type (already covered by the existing fixed
`broad_market_selloff`). Does not persist a scenario. No frontend rendering. No merge or
deploy is claimed.
