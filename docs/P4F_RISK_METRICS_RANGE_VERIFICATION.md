# Phase 4 follow-up — risk metrics card range selector

`docs/V2_BACKLOG.md`'s PR #60 entry named this as the one remaining gap
after "every field `GET /portfolio/risk-metrics` returns has frontend
rendering": the card's range was hardcoded to `1y` even though
`fetchRiskMetrics(range: "1y" | "2y")` and the backend endpoint already
support `2y`. Checked the actual current frontend code (not just the
backlog's older paragraph) before starting, since an adjacent Bollinger
Bands item flagged the same way in an earlier backlog entry turned out to
already be fully shipped in a later PR not yet reflected in that older
paragraph — confirmed this one is still genuinely open:
`frontend/src/pages/Portfolio.tsx` still had `["portfolio", "risk-metrics",
"1y"]` and `fetchRiskMetrics("1y")` hardcoded, and `title="Risk metrics
(1y)"` had no selector.

## What changed

`frontend/src/pages/Portfolio.tsx` only:

- Added `const [riskMetricsRange, setRiskMetricsRange] = useState<"1y" |
  "2y">("1y")`; the query key and `fetchRiskMetrics` call now use that
  state instead of the literal `"1y"`.
- The `DashboardCard`'s `title` is now `` `Risk metrics (${riskMetricsRange})` ``
  (was the static string `"Risk metrics (1y)"`).
- Added a `<select>` in the card's existing `action` slot (the same prop
  `DashboardCard` already defines for this purpose — used elsewhere on
  this page for the "Holdings" card's row-count label, just not yet for a
  selector), with `1 year`/`2 years` options, `aria-label="Risk metrics
  range"` (no visible `<label>`, matching the compact `action`-slot
  pattern already used for the Holdings card rather than the full
  labeled-field pattern `DailyHistory.tsx` uses for its own range
  selector, since this slot has no form/submit step — selecting
  immediately refetches, consistent with how `allocationQuery`/
  `attributionQuery` on the same page have no intermediate draft step
  either).
- `className="field-control"` reuses the same select styling already
  used by every other `<select>` in this codebase (`DailyHistory.tsx`,
  `Watchlists.tsx`).

No backend change — `GET /portfolio/risk-metrics?range=2y` already works;
only the frontend was missing a way to request it.

## Verification

- `npm run lint`: clean, no new warnings.
- `npm run build` (`tsc -b && vite build`): clean, same pre-existing
  >500kB chunk-size warning, unrelated to this change.
- `npm test -- --run`: 30 files, 417 tests passed — unchanged count.
  `Portfolio.tsx` has no dedicated test file today (confirmed by search;
  none of the Phase 4 analytics-card PRs #55-#60 added one either, per
  their own already-disclosed "no manual browser/visual check" note) —
  not added here either, consistent with that same disclosed boundary
  rather than a silent gap.
- No manual browser check was performed (same disclosed limitation as
  PRs #55-#60 on this same card).
