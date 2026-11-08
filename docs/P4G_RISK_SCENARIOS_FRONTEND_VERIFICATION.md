# Custom risk scenarios frontend wiring verification

Adds a new "Custom risk scenarios" card to `/portfolio`, calling `POST /risk/scenarios` (PR
#67) on form submit. The first **dynamic-list** form on this page — every prior form has a
fixed set of fields; this one lets the user add/remove 1-20 shock rows before submitting.

## Implemented by Grok, independently reviewed by me

Four files touched: `frontend/src/api/riskScenarios.ts` (new), `frontend/src/types/schemas.ts`
(additive — three new interfaces), `frontend/src/pages/Portfolio.tsx` (one new card, neither
"Trade impact preview" nor any other existing card touched), and the test file (extended, all
prior tests unchanged).

- Correctly reuses the existing `impactMoney`/`impactWeightChange` helpers (already defined for
  "Trade impact preview") rather than duplicating them — `loss_pct` goes through
  `impactWeightChange` (which uses `formatSignedPercent`), not a plain percent formatter,
  matching the backend's own documented behavior that a scenario can produce a gain.
- The add/remove row logic correctly clamps at both ends: "Add shock" disables at 20 rows (the
  backend's own upper bound), "Remove" disables when exactly 1 row remains (the backend's own
  lower bound) — both tested directly, including that removing a row correctly removes that
  specific row's inputs from the DOM (not just decrementing a count).
- `shock_pct` is sent as the raw string the user typed (`"-10"`, not re-parsed to a number and
  reformatted to `"-10.0000"`) — the reference test asserts the exact request payload
  `previewRiskScenarios` receives matches the user's own input text, consistent with how
  `TradeImpactRequestBody`'s own quantity/price fields are already passed through as strings.
- The gain-scenario test explicitly checks the rendered text contains a `-` and does **not**
  contain a `+`, directly verifying the sign is preserved rather than just checking the numeric
  magnitude.

## Independent verification

- Reviewed the full diff of all four files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **399 passed** (0 failed) — up from 395 before this unit (4
  new tests; all 395 pre-existing tests, including "Trade impact preview"'s own, still pass
  unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- Re-confirmed the reference test reuses the exact backend contract numbers from
  `docs/P4G_RISK_SCENARIOS_CONTRACT.md` (`"270.00"`/`"80.00"` → `total_after = "1550.00"`,
  `loss = "50.00"`, `loss_pct = "3.1250"`), already independently verified when PR #67 shipped
  — no new financial arithmetic exists in this frontend slice.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not add a symbol/sector autocomplete or validation beyond "non-empty" client-side — the
backend's own `422` surfaces through the existing error-message path if a request is
malformed. Does not persist a scenario. Does not change any other card on this page.
