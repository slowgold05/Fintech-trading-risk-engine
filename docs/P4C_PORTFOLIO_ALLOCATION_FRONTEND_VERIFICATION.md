# Sector allocation frontend wiring verification

Wires the backend-only `GET /portfolio/allocation` (PR #45) into the frontend: a new "Sector
allocation" card on the `/portfolio` page showing cash plus each sector's dollar value and
weight percentage. First frontend rendering of any of this session's Phase 4 analytics
(allocation, risk-metrics, attribution, trade-impact) — none had any UI before this unit.

## Implemented by Grok, independently reviewed by me

Four files touched, all in scope: `frontend/src/api/allocation.ts` (new),
`frontend/src/types/schemas.ts` (additive — three new interfaces, no existing one changed),
`frontend/src/pages/Portfolio.tsx` (one new `DashboardCard` section plus a new
`SectorAllocationTable` component, no existing section touched), and
`frontend/src/pages/valuationDisplay.test.tsx` (extended, no existing test changed).

- New types correctly use `string | null` for every dollar/percentage field (`AllocationSecurity`,
  `AllocationSector`, `AllocationResponse`) — matching the real backend's decimal-text
  convention, not the older `PortfolioResponse`'s plain-number convention. Values are converted
  with `Number(text)` immediately before handing them to the existing `formatCurrency`/
  `formatPercent` utilities, the appropriately low-rigor conversion for a read-only display (not
  reusing `historyData.ts`'s stricter chart-precision validation, which would have been the
  wrong tool here).
- Correctly distinguishes three states: loading (skeleton rows), `status === "incomplete"` (an
  `EmptyState` explaining a holding is unpriced, with no percentage rendered at all), and
  `status === "complete"` with zero sectors (cash row still shown, plus a distinct "No sector
  exposure" note) — not conflating "unavailable" with "genuinely zero."
- Test coverage scopes assertions to the new card specifically (`within(card)`), so the new
  tests cannot pass by accidentally matching unrelated text elsewhere on the page — a more
  rigorous check than a looser `screen.getByText` would have been.

## Independent verification

- Reviewed the full diff of all four files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **355 passed** (0 failed) across 27 test files — up from
  353 before this unit (2 new tests added, all 353 pre-existing tests, including every other
  test in `valuationDisplay.test.tsx`, still pass with the new `fetchAllocation` mock wired
  into the shared `beforeEach`).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors (the
  one build warning, a >500kB JS chunk, is pre-existing and unrelated).
- No manual browser/visual check was performed — verified via the automated component test
  (which renders the real `<Portfolio />` component tree and asserts on real DOM text) and the
  production build only, the same disclosed boundary the Bollinger Bands frontend unit already
  established for this kind of change.

## What this unit does not do

Does not render `GET /portfolio/risk-metrics` (nine metrics), `GET /portfolio/attribution`, or
`POST /portfolio/trade-impact` — each would be its own frontend slice. Does not add a pie chart
or any new charting dependency — a simple table, consistent with "match complexity to the
vision" for a dense data-reading page like this one; a visual chart could be a later
enhancement but is not required to make this data usable. Does not change any existing section
of the `/portfolio` page.
