# Correlations frontend wiring verification

Extends the existing "Risk metrics (1y)" card (PRs #57, #58) with `correlations` — the
per-pair correlation list from `GET /portfolio/risk-metrics` (PR #50). Third of the four
list-shaped risk-metrics fields to get frontend wiring; only `risk_contributions` remains.

## Implemented by Grok, independently reviewed by me

Three files touched, additive on top of everything already there: `frontend/src/types/
schemas.ts` (one field's type widened from the deliberately-loose `unknown[] | null`
placeholder to a proper `RiskCorrelation[] | null`, plus the new interface —
`risk_contributions` left untouched), `frontend/src/pages/Portfolio.tsx` (extends the existing
risk-metrics card only — the seven scalar stats and the `stress_scenarios` table are both
untouched), and the test file (extended, all prior tests unchanged).

- `correlation` is correctly rendered as a plain decimal ratio (`Number(value).toFixed(4)`),
  the same convention `formatBeta` already established for `portfolio_beta` — **not** passed
  through either percent formatter. Both new tests explicitly assert no `%` character appears
  in the correlation/return-count cells, catching the exact mistake that would be easy to make
  (treating a `[-1, 1]` ratio as if it were a percentage like every other field on this card).
- Correctly handles a pair-level `null` (insufficient common price history for that specific
  pair) independently of the whole-field `null` (fewer than two held symbols) — the reference
  test puts one real value and one `null` pair in the *same* response and asserts both render
  correctly in the same card.

## Independent verification

- Reviewed the full diff of all three files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **363 passed** (0 failed) — up from 361 before this unit (2
  new tests; all 361 pre-existing tests, including the `stress_scenarios` table's tests, still
  pass unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- No new financial arithmetic exists in this frontend slice — the backend's own correlation
  math was already independently verified when PR #50 shipped.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not render `risk_contributions` (the fourth and final list field — a separate, later
slice). Does not render `POST /portfolio/trade-impact`. Does not change the "Sector
allocation"/"P&L attribution" cards, the seven scalar stats, or the `stress_scenarios` table.
