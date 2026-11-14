# Line and area chart modes verification

Adds line and area chart modes to the daily history chart (`frontend/src/components/
DailyHistory.tsx`), closing the roadmap's Phase 3 line "Candlestick, line, and area chart
modes" — candlestick was the only mode available before this unit. Switching chart type is a
pure rendering toggle over already-fetched data, independent of the symbol/range/indicator
form.

## Implemented by Grok, independently reviewed by me

One component file and two test files touched. `frontend/src/components/historyData.ts` (the
data-parsing module) is byte-identical to before this change — confirmed with `git diff
--stat`, empty — this is pure rendering, no change to how candles or indicators are parsed.

- All three price series (candlestick, line, area) are created once per chart mount and never
  recreated on a mode switch — only their `visible` option and `setData` payload change,
  exactly the create-once/toggle-visibility pattern I asked for rather than a full chart
  teardown/rebuild on every click.
- The chart-type `<select>` is correctly placed **outside** the existing symbol/range/indicator
  `<form onSubmit>` and has its own `onChange` handler that only calls `setChartType` — a
  dedicated test (`"does not refetch history when the chart type changes"`) cycles through all
  three modes and asserts `fetchDailyHistory`/`fetchDailyIndicators` are never called again and
  the chart is never recreated (`createChart` still called exactly once), directly proving the
  single most important behavioral guarantee of this unit.
- Correctly identified and fixed the one real risk I flagged in the task: neither test file's
  mocked series objects had an `applyOptions` method before this unit. Added it to every mocked
  series in both `DailyHistory.test.tsx` and `DailyIndicators.test.tsx`'s `addSeries` mocks,
  and updated every pre-existing `addSeries` call-count/index assertion in
  `DailyIndicators.test.tsx` that the two new series (added to every chart mount) shifted.

## Independent verification

- Reviewed the full diff of all three files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **372 passed** (0 failed) — up from 368 before this unit (4
  new tests; all 368 pre-existing tests, across both touched test files and every other
  unrelated test file, still pass unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- Confirmed `frontend/src/components/historyData.ts` is byte-identical to before this change.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not add any new historical timeframe beyond the existing `1y`/`2y` (a separate roadmap
item on the same Phase 3 line — "Historical timeframes: 1M, 3M, 6M, 1Y, 2Y, and All"). Does not
add trade execution markers, price levels for open orders, or persisted chart preferences
(each its own separate roadmap item). Does not change `historyData.ts` or any indicator
parsing logic.
