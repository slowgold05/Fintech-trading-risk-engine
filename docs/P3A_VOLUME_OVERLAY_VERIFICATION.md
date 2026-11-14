# Daily chart volume overlay verification

This unit adds a volume histogram under the daily candlestick chart and a "Volume" column to
the session prices table on `GET /market/symbols/{symbol}/history`. It is frontend-only: the
backend already returns `volume` (an integer-string) on every bar
(`app/services/market_history.py`'s `_volume_text(row.volume_shares)`), unchanged by this unit.
No API, migration, grant, or provider change is part of this unit.

## Design

- `frontend/src/components/historyData.ts`: the bar-parsing loop that already built
  `CandlestickData` points (`historyCandles`) was refactored into a shared `parseBars` helper
  that also validates and converts each bar's `volume` string into a `HistogramData` point,
  colored to match that session's own candle color (`#34d399` up / `#fb7185` down, at 50% alpha
  so the histogram reads as a secondary series under the candles). `historyCandles` keeps its
  existing public signature and behavior exactly; a new `historyVolume` exposes the volume
  series under the same validation (any malformed bar throws for both, since they share one
  parse pass over the same `bars` array).
- `frontend/src/components/DailyHistory.tsx`: a new `addVolumeSeries` helper (parallel to the
  existing `addCandleSeries`/`addLineSeries`) adds a `HistogramSeries` with
  `priceFormat: { type: "volume" }` on its own price scale (`daily-history-volume`), margined to
  the bottom ~18% of the chart via `scaleMargins: { top: 0.82, bottom: 0 }` so it sits under the
  candles rather than overlapping them. It is created once per chart mount (alongside the candle
  series) and re-fed via `setData` on every data refresh, the same lifecycle the candle series
  already uses. The session prices table gained a "Volume" column between "Close" and the
  optional indicator column, displaying the exact cached decimal-free integer string from the
  bar (not the chart's rounded `number`).

## Files changed

- `frontend/src/components/historyData.ts`: `historyCandles` is now a thin wrapper over a new
  internal `parseBars`; added `historyVolume`; the internal volume-format validator (previously
  `volume(value): void`) is now `parseVolume(value): number`, additionally rejecting an
  out-of-safe-integer-range string (none of the existing fixtures or tests use such a value, so
  this is strictly a new, narrower-than-before check, not a behavior change for any passing case).
- `frontend/src/components/DailyHistory.tsx`: added `addVolumeSeries`/`VolumeSeriesHandle`;
  `AcceptedHistory`'s `"partial"` state carries a new `volume: HistogramData<Time>[]` field;
  `DailyHistoryCanvas` takes a `volume` prop, creates and feeds the histogram series through the
  same mount/update/dispose lifecycle as the candle series; `PriceRow` now includes `volume`; the
  session prices table has a new "Volume" column.
- `frontend/src/components/historyData.test.ts`: added a `historyVolume` describe block —
  numeric conversion aligned with `historyCandles`' own points, up/down coloring, the empty-bars
  case, 9 rejected malformed volume values, and the same whole-series-rejects-on-one-bad-bar
  behavior `historyCandles` already has.
- `frontend/src/components/DailyHistory.test.tsx`: extended the chart-mock (`mountChart`) to
  return a distinct `setData` per added series instead of one shared mock, since there are now
  two series created at chart-mount time (candle, volume) instead of one; added assertions that
  the histogram series is created with `HistogramSeries`/`priceFormat: { type: "volume" }` and
  fed the expected colored points, that the "Volume" column header renders, and that a refetch
  re-feeds the volume series with the new per-session colors.
- `frontend/src/components/DailyIndicators.test.tsx`: its own chart mock asserted exactly two
  `addSeries` calls (candle, then line) for an active indicator; updated to three (candle,
  volume, line) and one (candle, volume) when no indicator is active, matching the new
  series-creation order. No indicator *behavior* assertion changed.
- `tests/browser/test_p3a_history.py`: added a one-line assertion that the expanded session
  prices table contains the new "Volume" header text, alongside the existing price-value checks.

## Verification run, 2026-11-07

- `npx tsc -b --noEmit`: clean.
- `npm run lint`: clean.
- `npm run test` (Vitest): **314 passed (314)**, 26 test files passed (26) — up from 301 (the
  exchange-calendar unit's final count) by 13 new tests (7 in `historyData.test.ts`'s new
  `historyVolume` block, plus assertions added to existing `DailyHistory.test.tsx` cases without
  adding new `it` blocks there).
- `npm run build`: succeeds, same pre-existing ~568 kB main bundle size warning as before (no new
  dependency was added — `lightweight-charts`' `HistogramSeries` is part of the already-installed
  package).
- Backend: untouched by this unit except the one-line browser-test assertion above; the backend
  pytest suite is unaffected and was not expected to change.
- Browser (`tests/browser/test_p3a_history.py`): not run locally — Selenium is blocked on
  Windows in this environment per this project's own documented restriction; verification relies
  on the CI `browser` job (Linux) for this file, same as every prior unit in this stack. The one
  assertion added is additive to an existing, already-passing test path and does not change any
  existing assertion's expected value.

This does not close P3-A (RSI, MACD, other timeframes, preferences remain explicitly deferred
per `docs/P3A_INDICATOR_CONTRACT.md`). No merge or deploy is claimed.
