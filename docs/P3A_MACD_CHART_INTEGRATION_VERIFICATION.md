# MACD chart integration verification

This unit adds `macd` as a fourth selectable chart indicator, exposing PR #35's backend MACD
support. Frontend-only. No backend, migration, or provider change. This was the most
architecturally involved frontend unit of the session: three new chart series sharing one panel
(MACD line, signal line, histogram), and a genuinely new validation case — MACD, its signal, and
its histogram can be **negative**, unlike RSI's bounded 0-100 scale, so the existing
zero-permissive-but-non-negative RSI validators were not sufficient and needed a sibling pair
that also accepts a negative sign.

## Implemented by Grok, independently verified by me

Scoped to 6 files via per-file `--allow` rules. Grok's implementation:
- New `canonicalSignedValue`/`chartSignedNumber` in `historyData.ts`, accepting an optional
  leading `-`, kept entirely separate from RSI's `canonicalIndicatorValue`/`chartIndicatorNumber`
  (unchanged, still reject negative numbers) and from `canonicalPrice`/`chartNumber` (OHLC,
  untouched, still strictly positive).
- A genuinely new per-point parser (`parseMacdPoints`/`signedSeriesPoint`) that checks
  `value`/`signal`/`histogram` independently for null vs. real, rather than forcing MACD through
  the existing single shared `warmup`-index cutoff the other three names use — correctly
  recognizing that MACD's two independently-timed warm-ups (line vs. signal/histogram) can't be
  expressed as one cutoff. Returns early with a macd-specific object shape before reaching the
  SMA/EMA/RSI loop, which is otherwise completely untouched.
- Three new chart series (`addMacdLineSeries`/`addMacdSignalSeries`/`addMacdHistogramSeries`)
  sharing one new price scale, on the same screen band RSI's own scale already occupies
  (intentional — `rsi` and `macd` are mutually exclusive, so they never populate that band
  simultaneously even though both sets of series objects exist on the chart at all times).
  Histogram bars are colored by sign at the `DailyHistory.tsx` layer (reusing the volume
  histogram's up/down colors), since `historyData.ts` was explicitly told to stay a pure parser
  with no rendering concerns.
- Went beyond the literal spec in two places, both genuine correctness improvements: added
  `macdSignal`/`macdHistogram` length checks to `acceptHistory`'s existing validation (I only
  asked for this "when relevant"; it did it properly) and extended `alignedTimes` to check
  per-index time alignment for both new arrays, not just the existing candle/line check.
- Caught and fixed, unprompted, a leftover gap in the *previous* unit's own test file: an old
  test used `"macd"` as an example of an *invalid* indicator name — now stale since `"macd"` is
  valid — updated to `"vwap"` instead. This is exactly the "move the now-valid name out of the
  invalid-name list" correction pattern from earlier units in this session, applied correctly
  without being told to look for it there specifically.

## A false alarm I almost chased as a real bug

Running the full suite initially showed one failing test
(`DailyIndicators.test.tsx > clears the inactive series when SMA and MACD swap on the same
chart`) with `createChart` called twice instead of once. I added temporary debug logging rather
than assuming either "flake" or "real bug" outright (per the lesson recorded from PR #33/#34).
The debug run showed `accepted.state` staying `"partial"` at every step — ruling out a
conditional-unmount theory — and then, on a clean rerun, the test **passed with zero changes**.
Clearing `node_modules/.vite` and rerunning confirmed it definitively: this was a stale
Vite/Vitest transform-cache artifact from earlier in the session, not a defect in Grok's code or
the test. Reverted the temporary debug logging before proceeding; the underlying implementation
was correct all along.

## Independent verification I did myself

- `git status` confirmed only the 6 scoped files changed.
- `npx tsc -b --noEmit`, `npm run lint`, `npm run build`: clean.
- `npm run test`: **343 passed (343)**, up from 336 by the 7 new tests (4 in
  `historyData.test.ts`'s new `indicatorOverlay MACD` block, 2 new `DailyIndicators.test.tsx`
  cases, 1 updated assertion elsewhere).
- Read every line of the `historyData.ts`/`DailyHistory.tsx` diffs against the spec, specifically
  confirming `canonicalIndicatorValue`/`chartIndicatorNumber`/`canonicalPrice`/`chartNumber` were
  not modified (RSI must still reject negatives; OHLC must stay strictly positive).
- Added a browser-test check myself (Grok's scope excluded `tests/browser/`): selects `macd`
  against the existing 6-bar indicator fixture (far short of MACD's fixed 26-close requirement),
  exercising the genuine `"insufficient"` path end-to-end — confirms the UI accepts `macd`
  without crashing, the "Signal period" label swap works, and the generic warm-up copy renders.
  A fully-warmed-up MACD value would need a much longer seeded series than this fixture already
  has; deferred as a reasonable scope boundary for this check, not a gap in the real
  implementation (which the unit tests already prove against the real formula).

## What changed

- `frontend/src/api/indicators.ts`: `IndicatorName` gained `"macd"`.
- `frontend/src/components/historyData.ts`: new `canonicalSignedValue`/`chartSignedNumber`;
  `IndicatorOverlay` gained optional `macdSignal`/`macdHistogram`; new `parseMacdPoints` path in
  `indicatorOverlay`, returning early for `macd` before the existing SMA/EMA/RSI warmup loop;
  `_closesRequired`-equivalent status threshold uses the fixed slow period (`26`) for `macd`.
- `frontend/src/components/DailyHistory.tsx`: three new series builders sharing one price scale;
  sign-based histogram coloring; a third independent ref/series group in `DailyHistoryCanvas`,
  always created and always explicitly fed; a `<option value="macd">`; "Signal period" label
  swap; a generic (non-hardcoded-count) warm-up sentence for MACD; new `acceptHistory`/
  `alignedTimes` checks for the two new arrays.
- `frontend/src/components/historyData.test.ts`, `DailyHistory.test.tsx`,
  `DailyIndicators.test.tsx`: new MACD-specific tests, plus the stale invalid-name fix.
- `tests/browser/test_p3a_indicators_ui.py` (mine): one new leg selecting MACD against the
  existing fixture's insufficient-data path.

## Verification run, 2026-11-07

- `npx tsc -b --noEmit`: clean.
- `npm run lint`: clean.
- `npm run test`: **343 passed (343)**, 27 files.
- `npm run build`: succeeds, same pre-existing bundle-size warning.
- Browser (`tests/browser/test_p3a_indicators_ui.py`): not run locally (Selenium blocked on
  Windows in this environment); relies on CI's `browser` job, same as every prior chart unit.

This does not close P3-A, does not add configurable fast/slow MACD periods, and does not change
the backend. No merge or deploy is claimed.
