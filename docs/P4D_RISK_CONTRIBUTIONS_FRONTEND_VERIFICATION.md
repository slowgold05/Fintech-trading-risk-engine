# Risk contributions frontend wiring verification

Extends the existing "Risk metrics (1y)" card (PRs #57-#59) with `risk_contributions` — the
last of the four list-shaped risk-metrics fields. With this unit, **every field**
`GET /portfolio/risk-metrics` returns has frontend rendering: seven scalar stats plus
`stress_scenarios`, `correlations`, and now `risk_contributions`.

## Implemented by Grok, independently reviewed by me

Three files touched: `frontend/src/types/schemas.ts` (the last remaining placeholder field,
`risk_contributions`, widened from `unknown[] | null` to a proper `RiskContribution[] | null`
— every field in `RiskMetricsResponse` is now properly typed, none loosely typed), `frontend/
src/pages/Portfolio.tsx` (extends the existing card only — the seven scalar stats and the
`stress_scenarios`/`correlations` tables are all untouched), and the test file (extended, all
prior tests unchanged).

- Correctly uses plain `formatPercent` (not `formatSignedPercent`) for both `weight_pct` and
  `risk_contribution_pct` — both are genuine, non-negative percentages in this specific field's
  contract (unlike attribution's signed contribution percentage, or correlation/beta's unitless
  ratios elsewhere on this same card).
- Took the "keep it simple" option I explicitly offered rather than adding an unrequested
  sign/comparison visual cue — a reasonable, correctly-judged choice given the task said either
  was acceptable.
- The reference test reuses the exact contract numbers (`AAA`/`BBB`, `"38.7968"`/`"61.2032"`)
  already independently verified when the backend unit (PR #52) shipped, including the
  correction to that contract's own worked reference caught during that unit's review — no new
  arithmetic to re-verify here.

## Independent verification

- Reviewed the full diff of all three files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **365 passed** (0 failed) — up from 363 before this unit (2
  new tests; all 363 pre-existing tests, including the `stress_scenarios`/`correlations`
  tables' tests, still pass unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Every field of `GET /portfolio/risk-metrics` now has frontend rendering — there is no more
backend data from that endpoint left unwired. Still open: `POST /portfolio/trade-impact`'s own
UI (a form, not a read-only card, so a different kind of frontend work) and a range selector
(`1y`/`2y`) for the risk metrics card, currently hardcoded to `1y`.
