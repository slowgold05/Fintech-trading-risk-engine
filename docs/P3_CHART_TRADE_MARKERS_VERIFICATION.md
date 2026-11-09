# Trade execution markers and open-order price lines verification

Adds two chart overlays to the daily history chart: execution markers (one per trade on the
shown symbol) and dashed price lines (one per open limit order on the shown symbol), closing
the roadmap's "Trade execution markers on historical charts," "Price levels for open limit
orders," and "Plot fills and active orders on charts" lines. Design written first as
`docs/P3_CHART_TRADE_MARKERS_DESIGN.md`. No new backend endpoint — reuses the existing
`fetchTrades`/`fetchOrders`, filtered client-side to the shown symbol.

## Implemented by Grok, independently reviewed by me

Three files touched: `DailyHistory.tsx`, and its own plus `DailyIndicators.test.tsx`'s test
files (both correctly updated with the new mocks, per the design doc's explicit call-out that
the latter also mounts this component and would otherwise break). `historyData.ts`,
`api/trades.ts`, and `api/orders.ts` are all byte-identical — confirmed with `git diff --stat`,
empty on all three.

- **A genuine correction to my own task wording, caught and self-corrected without needing a
  follow-up round.** I described `createSeriesMarkers` as "a top-level function import from
  `lightweight-charts`," which could be read as "add a static `import { createSeriesMarkers }`
  statement." Grok correctly recognized this would conflict with the existing architecture:
  `lightweight-charts` is already loaded via a `dynamic` `import("lightweight-charts").then(...)`
  inside the chart-creation effect specifically so the module loads lazily, and
  `DailyHistoryLifecycle.test.tsx` depends on that dynamic import staying gated behind a
  controllable promise. Grok used `charts.createSeriesMarkers(...)` on the already-dynamically-
  imported module object instead — the same way `charts.CandlestickSeries`/`charts.LineSeries`
  are already referenced elsewhere in this file — avoiding a regression I had not flagged.
- Overlay updates for trades/orders were deliberately split into their **own** `useEffect`s,
  separate from the existing candle `setData` effect — a genuine improvement over what I asked
  for (I described folding the marker update into the existing resize/data-update effect): a
  trade or order refresh no longer re-calls `series.setData(points)` on the price series,
  avoiding an unnecessary price replot whenever only the overlay data changes.
- Price lines are correctly removed before new ones are created on every relevant update (not
  just at symbol-change time) — a dedicated test explicitly asserts the remove call's
  `invocationCallOrder` is before the corresponding create call's, and a separate test
  confirms the "orders cleared to none" case also correctly removes the stale line.
- Both overlays are correctly duplicated across all three price series (candlestick, line,
  area) per the design doc's deliberate hedge against an unverified library behavior (whether
  hiding a series also hides its own markers/price lines) — every test asserts all three
  series received the same `setMarkers`/`createPriceLine` calls, not just the active one.
- The documented UTC-date-mapping limitation is directly tested: a trade whose `executed_at`
  date does not match any loaded candle is confirmed excluded from the markers array passed to
  `setMarkers`, with an explicit assertion it never appears in any call, not just the last one.

## Independent verification

- Reviewed the full diff of all three files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **395 passed** (0 failed) across 28 test files — up from
  390 before this unit (5 new tests; all 390 pre-existing tests, including every one in
  `DailyIndicators.test.tsx`, still pass with its updated mocks).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- Confirmed `historyData.ts`, `api/trades.ts`, and `api/orders.ts` are byte-identical.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not perform exchange-calendar-aware trade-to-session mapping (a trade's UTC calendar date
is matched directly against a candle's date — a documented, deliberate simplification for a
visual overlay, not a financial calculation). Does not add markers/price lines for symbols
other than the one currently shown. Does not poll for new trades/orders — refreshes only on
form resubmission, the same cadence every other data source on this chart already uses. Does
not add price levels for open market orders (they carry no `limit_price`) — the roadmap's own
wording scopes this to open *limit* orders specifically.
