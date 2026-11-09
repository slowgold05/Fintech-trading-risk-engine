# P&L attribution frontend wiring verification

Wires the backend-only `GET /portfolio/attribution` (PR #53) into the frontend: a new "P&L
attribution" card on `/portfolio`, additive on top of the just-shipped "Sector allocation"
card (PR #55), following the exact same structural pattern.

## Implemented by Grok, independently reviewed by me

Four files touched: `frontend/src/api/attribution.ts` (new), `frontend/src/types/schemas.ts`
(additive — three new interfaces, allocation's own untouched), `frontend/src/pages/
Portfolio.tsx` (one new `DashboardCard` plus a `PnlAttributionTables` helper, the existing
"Sector allocation" card's markup unchanged), and `frontend/src/pages/valuationDisplay.test.tsx`
(extended, existing allocation tests unchanged).

- Correctly uses `formatSignedPercent` — not `formatPercent` — for `pnl_contribution_pct`,
  since this field is signed and unbounded, exactly the distinction I asked for. The test
  explicitly drives both edge cases from the real contract reference: a contribution over
  `100%` (`"+130.31%"`, AAPL) and a negative one (`"-30.31%"`, MSFT), scoped to each security's
  own table row via `within(apple)`/`within(microsoft)`, not just checked loosely anywhere on
  the page.
- Correctly distinguishes `null` for two different reasons (an unpriced holding making the
  whole response `"incomplete"`, versus a single security's `total_pnl`/`unrealized_pnl` being
  individually null for its own unpriced reason even within a complete response) — both render
  as the same "Unavailable" text via small `attributionMoney`/`attributionContribution` helpers,
  a reasonable UI simplification for this first slice (the two cases are visually
  indistinguishable to the user, which is acceptable here since the card-level incomplete state
  already explains the broader unavailability).
- The sector table and security table are each independent `<table>` elements within one card,
  with the same "no sector exposure" `EmptyState` fallback the allocation card already
  established for an empty sector list.

## Independent verification

- Reviewed the full diff of all four files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **357 passed** (0 failed) — up from 355 before this unit
  (2 new tests; all 355 pre-existing tests, including both "Sector allocation" card tests,
  still pass unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not render `GET /portfolio/risk-metrics` (nine metrics) or `POST /portfolio/trade-impact`
— each a separate future frontend slice. Does not add a chart — two simple tables, consistent
with the allocation card's own "no new charting dependency for this slice" choice. Does not
change the existing "Sector allocation" card.
