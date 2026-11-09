# Risk metrics frontend wiring verification (scalar fields, first slice)

Wires the backend-only `GET /portfolio/risk-metrics` (PRs #47-#52) into the frontend: a new
"Risk metrics (1y)" card on `/portfolio`, additive on top of the Sector allocation (PR #55) and
P&L attribution (PR #56) cards, rendering the seven **scalar** fields only. The three
list-shaped fields (`correlations`, `stress_scenarios`, `risk_contributions`) are each a
separate, later frontend slice — not part of this unit, consistent with the backend's own
nine-metric incremental rollout.

## Implemented by Grok, independently reviewed by me

Four files touched: `frontend/src/api/riskMetrics.ts` (new), `frontend/src/types/schemas.ts`
(additive — one new interface, the three list fields loosely typed `unknown[] | null` since
this slice doesn't render them), `frontend/src/pages/Portfolio.tsx` (one new card plus a
`RiskMetricsStats` helper, neither existing card touched), and `frontend/src/pages/
valuationDisplay.test.tsx` (extended, existing tests unchanged).

- Correctly does **not** key field visibility off the response's top-level `status` — each of
  the seven scalar fields is rendered or shown "Unavailable" purely based on its own
  `null`/non-null value, exactly the nuance I called out (unlike allocation/attribution's
  all-or-nothing `status`, risk-metrics' scalar fields each have independent null-gating
  thresholds on the backend). The reference test proves this directly: a single `"complete"`
  response with some fields present and others `null` renders both states correctly in the
  same card render, not across two separate test runs.
- `portfolio_beta` is correctly rendered as a plain `Number(value).toFixed(4)` ratio, never
  passed through `formatPercent`/`formatSignedPercent` — a dedicated test asserts no `%`
  character appears anywhere in that row's text content.
- Every genuine percentage field (`historical_volatility_pct`, `max_drawdown_pct`,
  `historical_var_95_pct`/`_99_pct`, `expected_shortfall_95_pct`/`_99_pct`) correctly uses plain
  `formatPercent`, not `formatSignedPercent` — these are documented in the backend contract as
  non-negative loss magnitudes, unlike attribution's signed, unbounded contribution percentage.

## Independent verification

- Reviewed the full diff of all four files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **359 passed** (0 failed) — up from 357 before this unit (2
  new tests; all 357 pre-existing tests, including both allocation and attribution card tests,
  still pass unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not render `correlations`, `stress_scenarios`, or `risk_contributions` (each a separate
future slice — all three are list-shaped and would need their own table/list UI, unlike these
seven scalars). Does not add a range selector (`1y`/`2y`) — hardcoded to `1y` for this first
slice. Does not render `POST /portfolio/trade-impact`. Does not change either existing
allocation or attribution card.
