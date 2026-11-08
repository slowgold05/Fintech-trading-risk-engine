# Stress scenarios frontend wiring verification

Extends the existing "Risk metrics (1y)" card (PR #57) with `stress_scenarios` — the fixed
three-scenario list from `GET /portfolio/risk-metrics` (PR #51). Second of the three
list-shaped risk-metrics fields to get frontend wiring (`correlations` and
`risk_contributions` remain open).

## Implemented by Grok, independently reviewed by me

Three files touched, all additive to what already existed: `frontend/src/types/schemas.ts`
(one existing field's type widened from the deliberately-loose `unknown[] | null` placeholder
to a proper `StressScenario[] | null`, plus the new `StressScenario` interface —
`correlations`/`risk_contributions` left untouched as planned), `frontend/src/pages/
Portfolio.tsx` (extends the existing risk-metrics card only — the seven-scalar-field
`RiskMetricsStats` rendering is untouched, and neither the allocation nor attribution card was
touched), and the test file (extended, all prior tests unchanged).

- `shock_pct` (a fixed literal like `"-10.0000"`) is rendered as plain formatted text, correctly
  **not** passed through `formatPercent` — it is an input constant, not a computed magnitude
  the way `loss_pct` is.
- `loss_pct` correctly reuses the existing `formatRiskPercent` helper (non-negative, same as
  the scalar VaR/ES fields), not `formatSignedPercent` — stress-test loss percentages are never
  negative by the backend's own design, unlike attribution's signed contribution percentage.
- `affected_symbol` is correctly rendered only on the `single_security_worst_holding` row — the
  other two scenarios never have this field, and the test explicitly asserts `"AAPL"` does not
  leak into either of the other two rows.

## Independent verification

- Reviewed the full diff of all three files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **361 passed** (0 failed) — up from 359 before this unit (2
  new tests; all 359 pre-existing tests, including every other card's tests, still pass
  unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- Confirmed the reference test uses the exact contract numbers from
  `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 5.5 (`"60.00"`/`"3.7500"`,
  `"75.00"`/`"4.6875"`, `"90.00"`/`"5.6250"` with `"AAPL"`), already independently verified
  when the backend unit shipped — no new financial arithmetic exists in this frontend slice to
  re-derive.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not render `correlations` or `risk_contributions` (each a separate, later slice). Does not
render `POST /portfolio/trade-impact`. Does not change the "Sector allocation" or "P&L
attribution" cards, or the risk-metrics card's existing seven-scalar-field rendering.
