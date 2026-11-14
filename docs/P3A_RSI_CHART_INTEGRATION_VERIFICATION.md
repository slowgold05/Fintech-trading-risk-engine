# RSI chart integration verification

This unit adds `rsi` as a third selectable chart indicator, following
[P3A_RSI_INDICATOR_VERIFICATION.md](P3A_RSI_INDICATOR_VERIFICATION.md) (the backend-only RSI
unit) the same way the original SMA/EMA chart integration followed the SMA/EMA backend unit — see
[P3A_CHART_INTEGRATION_VERIFICATION.md](P3A_CHART_INTEGRATION_VERIFICATION.md). Frontend-only.
No backend, migration, or provider change.

## The one real design decision

RSI is a 0-100 oscillator, not a price. SMA/EMA correctly share the main price scale with the
candles (they're price averages); plotting RSI there too would be visually meaningless — a
0-100 line against candles that might be in the hundreds. RSI gets its own price scale,
`daily-history-rsi`, the same pattern the volume histogram already uses for its own
`daily-history-volume` scale, margined to the top ~22% of the chart (`scaleMargins: { top: 0.05,
bottom: 0.68 }`), distinct from the candles' main scale and the volume histogram's bottom band.

## Implemented by Grok, independently verified by me

Scoped to exactly 6 frontend files via per-file `--allow` rules (same pattern as the RSI backend
unit). The task spec called out the one genuine architectural risk in advance: the existing
single `lineSeriesRef`/`syncIndicatorLine` can't be reused for RSI, because switching indicators
within one mounted chart (no remount) would leave a series stuck on whichever price scale it was
first created for. The spec required a second, independent ref/series for RSI, both created
unconditionally at chart-mount time (like the volume histogram), with the inactive one always
explicitly fed `[]` on every update — not skipped — so a stale line can't visually linger after a
switch.

Grok's implementation matches this exactly: `addRsiSeries` (new, own price scale, own color),
`rsiSeriesRef`/`rsiLineRef` alongside the existing `lineSeriesRef`/`lineRef`, and
`DailyHistoryCanvas`'s two props (`priceScaleLine` for sma/ema, `rsiLine` for rsi) each written on
every render via `?? []`. It also independently caught two things the task description didn't
spell out as explicitly:
- `indicatorOverlay`'s `status` computation (not just the warm-up `line`/`values` computation)
  needed the same `period + 1` threshold for `rsi`, via a `closesRequired` variable — otherwise a
  legitimate RSI `"insufficient"` response from the backend would have failed the client-side
  `if (body.status !== status) throw` check.
- The warm-up copy in `IndicatorFacts` ("Warm-up: the first N observed stored closes...") needed
  the same indicator-aware count.

Independent verification I did myself (not just re-reading the diff):
- `git status` confirmed only the 6 scoped files changed.
- Re-ran `npx tsc -b --noEmit` (clean), `npm run lint` (clean), `npm run build` (succeeds, same
  pre-existing bundle-size warning), and `npm run test` (**320 passed**, up from 314 by exactly
  the 6 new tests: 4 in `historyData.test.ts`'s new `indicatorOverlay RSI` block, 2 in
  `DailyIndicators.test.tsx`).
- Read every changed line in `historyData.ts` and `DailyHistory.tsx` against the spec; confirmed
  `historyCandles`/`parseBars` (OHLC bar prices) and `assertBounds`/volume-coloring are
  byte-for-byte untouched — the new `canonicalIndicatorValue`/`chartIndicatorNumber` helpers
  (allowing exactly `0`, unlike `canonicalPrice`/`chartNumber`) are used only inside
  `indicatorOverlay`'s per-point parsing, confirmed by one of the new tests asserting a bar OHLC
  price of `"0.000000"` still throws `"Price is invalid."` in the same test file as the new
  RSI-value-of-zero case that must *not* throw.
- Confirmed the "no remount, clears the inactive series" test genuinely exercises that path (not
  a false positive): it pre-seeds the TanStack Query cache for the target indicator's query key
  before switching, which is why the chart stays mounted (`chartApi.createChart` called once)
  instead of unmounting while a cold query is pending — then asserts the previously-active
  series is fed `[]` and the newly-active one gets real data, in both directions (SMA to RSI and
  back).
- Added a browser-test check myself (Grok's scope excluded `tests/browser/`, since Selenium is
  blocked locally on Windows anyway): selecting RSI with period 3 against the existing
  `test_indicator_overlay_ui` fixture (`CLOSES = (1, 4, 2, 8, 3, 9)`), independently re-derived
  the expected 6-point RSI series from the Wilder formula in a separate Python script (not from
  the frontend or backend code): `["Warm-up", "Warm-up", "Warm-up", "81.818182", "48.648649",
  "70.312500"]` — 3 leading warm-ups (period, not period-1), matching the backend's own warm-up
  length. Captured `rsi-desktop.png` for screenshot review via the CI `browser` job (Selenium is
  blocked locally; this follows the same CI-dependent verification pattern as every other chart
  change in this stack).

## What changed

- `frontend/src/api/indicators.ts`: `IndicatorName` gained `"rsi"`.
- `frontend/src/components/historyData.ts`: the `indicatorOverlay` name check now allows `"rsi"`;
  its warm-up length and status threshold are indicator-aware (`period` for rsi, `period - 1` /
  `period` for sma/ema's warm-up and status respectively, unchanged); new
  `canonicalIndicatorValue`/`chartIndicatorNumber` (zero-permissive) used only for indicator point
  values, not OHLC prices.
- `frontend/src/components/DailyHistory.tsx`: new `addRsiSeries`/`RsiSeriesHandle`; a third
  `<option value="rsi">`; `readIndicatorChoice` and `indicatorLabel` extended; `IndicatorFacts`'s
  warm-up sentence is indicator-aware; `DailyHistoryCanvas` gained a second independent
  ref/series pair for RSI, always fed (never skipped) on every chart-creation and data-update
  pass.
- `frontend/src/components/historyData.test.ts`: new `indicatorOverlay RSI` describe block (4
  tests: normal value with the correct warm-up length, an RSI value of exactly `0` alongside a
  proof that OHLC zero-price rejection is unaffected, the `period`-vs-`period+1` insufficient
  boundary, and an invalid-name rejection).
- `frontend/src/components/DailyHistory.test.tsx`: chart mock updated to disambiguate series by
  `priceScaleId` instead of series-type identity alone (RSI and SMA/EMA both use `LineSeries`).
- `frontend/src/components/DailyIndicators.test.tsx`: same mock update, plus 2 new tests (RSI
  renders on its own scale with the right label/warm-up text; switching SMA/RSI on the same
  mounted chart clears the inactive series in both directions).
- `tests/browser/test_p3a_indicators_ui.py` (mine, not Grok's): one new leg in
  `test_indicator_overlay_ui` selecting RSI period 3 against the existing fixture, asserting the
  independently-derived 6-point reference series and capturing `rsi-desktop.png`.

## Verification run, 2026-11-07

- `npx tsc -b --noEmit`: clean.
- `npm run lint`: clean.
- `npm run test`: **320 passed (320)**, 26 files, up from 314.
- `npm run build`: succeeds, same pre-existing bundle-size warning.
- Browser (`tests/browser/test_p3a_indicators_ui.py`): not run locally (Selenium blocked on
  Windows in this environment); relies on CI's `browser` job, same as every prior chart unit in
  this stack. The added assertions are additive to an already-passing test path.

This does not add MACD or any other indicator, does not change the backend, and does not close
P3-A. No merge or deploy is claimed.
