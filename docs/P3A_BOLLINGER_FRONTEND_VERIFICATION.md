# Bollinger Bands frontend wiring verification

Wires the backend-only Bollinger Bands indicator (`docs/P3A_INDICATOR_CONTRACT.md` section 15,
shipped previously with no frontend changes) into the daily history chart. Per section 15.6,
this renders the middle/upper/lower bands as three overlay lines on the **main price scale**,
not a sub-panel — unlike RSI/MACD, Bollinger Bands overlay directly on price. This closes the
frontend half of the roadmap's Phase 3 line "SMA, EMA, Bollinger Bands, RSI, and MACD": all five
indicators are now selectable and plotted in the daily history chart.

## Implemented by Grok, independently reviewed by me

Five files touched, all in scope: `frontend/src/api/indicators.ts`,
`frontend/src/components/historyData.ts`, `frontend/src/components/DailyHistory.tsx`,
`frontend/src/components/indicatorData.test.ts`, `frontend/src/components/DailyIndicators.test.tsx`.
No backend file was touched; no other frontend file was touched (confirmed with
`git status --short`, which showed exactly these five against a clean tree otherwise).

- `IndicatorName` gained `"bollinger"`.
- `historyData.ts` gained `parseBollingerPoints`, following the existing `parseMacdPoints`
  pattern: the middle `value` is parsed with the same strict `canonicalPrice`/`chartNumber` path
  `sma`/`ema` already use (it must stay a positive canonical price, since it is literally the
  SMA), while `upper`/`lower` are parsed with the existing `signedSeriesPoint` helper — the same
  one MACD already uses — so a zero or negative band reading is accepted even though real
  equity data should never produce one. Added a genuine invariant check I did not see in any
  prior indicator: `upper`/`lower` must be `null` on exactly the same indices the middle value
  is `null` on (the shared `period - 1` warm-up), and both non-null everywhere else; a payload
  violating that in either direction throws rather than silently rendering a mismatched band.
- `IndicatorOverlay` gained optional `bollingerUpper`/`bollingerLower`, mirroring the existing
  `macdSignal`/`macdHistogram` naming convention exactly.
- `DailyHistory.tsx` gained two new chart series (`addBollingerUpperSeries`/
  `addBollingerLowerSeries`, both dashed violet `#c4b5fd`, `lineStyle: 2`) added with no
  `priceScaleId` override — confirmed they share the candles' main price scale, not a new
  sub-panel, matching section 15.6's explicit design call. The existing `priceScaleLine` prop
  (already excluding only `rsi`/`macd`) needed no change to carry Bollinger's middle band — it
  already flows through the same path `sma`/`ema` use. `acceptHistory` and `alignedTimes` each
  gained a parallel validation block to the existing MACD one, requiring `bollingerUpper`/
  `bollingerLower` to be present and time-aligned with the candles.
- A minor, correct refinement not asked for: `setBollingerBandData` skips writing an empty
  `setData([])` to a band series that was never painted, so a plain (non-Bollinger) chart
  mount doesn't needlessly call `setData` on the two band series every render. Verified this is
  behaviorally transparent — once a real band has been drawn, switching away still clears it.

One real mid-task hazard, self-corrected by Grok: my first launch attempt for this task was
killed by my own tooling error (see "What went wrong on my end" below) partway through editing,
leaving a duplicated Bollinger parser/branch in `historyData.ts`. The second (successful) launch
found that leftover duplication on disk, recognized the module would not load with it, and
removed the duplicate before finishing — confirmed clean via the diff review below, with no
duplicate function or branch anywhere in the final files.

## What went wrong on my end (disclosed, not hidden)

My first Grok launch for this task failed because I appended a stray trailing `&` to the Grok
command on top of the Bash tool's own `run_in_background: true` — backgrounding the process
twice. The outer wrapper shell returned immediately (`echo "launched pid $!"` printed, then the
shell exited), which killed the inner backgrounded Grok process before it could finish; the
tool's own background-task tracking reported "completed" because the *wrapper* exited cleanly,
not because Grok had. `git status --short` showed zero changed files, which is what caught it.
Second attempt removed the trailing `&` (Grok now runs in the foreground of the already-background
Bash call) and completed normally.

## Independent verification

- Re-read the full diff of all five files directly (not Grok's self-report) before running
  anything.
- `npm run test` inside `frontend/`: **353 passed**, 0 failed, across 27 test files — up from a
  pre-change baseline of fewer tests (this unit added 6 cases to `indicatorData.test.ts` and 1
  end-to-end case to `DailyIndicators.test.tsx`; all other 346 were already passing before this
  unit and still pass after it).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors. The
  one build warning (a >500kB JS chunk) is pre-existing and unrelated to this change.
- Re-derived the contract's own worked reference (section 15.5: closes
  `[10, 12, 11, 13, 14, 12, 15]`, period 3) directly from the new tests' fixtures — both
  `indicatorData.test.ts` and `DailyIndicators.test.tsx` use the exact same six values
  (`"12.632993"`/`"9.367007"` at i=2 through `"16.161105"`/`"11.172228"` at i=6) the backend
  contract already verified independently. No new arithmetic was introduced by this unit — it is
  wiring only, so there is no new financial computation to re-derive from scratch.
- Confirmed by direct code reading (not Grok's claim) that neither band series has a
  `priceScaleId`, so both share the candles' main scale rather than creating a new sub-panel —
  the test file independently asserts `bands[0]?.[1]?.priceScaleId` is `undefined` for both.

## What this unit does not do

- No manual browser/visual check was performed — I verified this purely through the automated
  component test (which mocks `lightweight-charts` and asserts the exact `addSeries`/`setData`
  calls the real chart would receive) and the production build. I did not start the dev server
  and look at a rendered chart. The component-level test is a strong substitute for this specific
  change (it asserts the real series configuration object, including color and dash style), but
  it is not the same as a visual confirmation.
- Does not add a shaded fill between the bands (section 15.6 explicitly scoped this unit to
  overlay lines, not a filled area — lightweight-charts has no first-class two-line-fill
  primitive without an added plugin, which is out of scope here).
- Does not add user-configurable band-width (`k`), consistent with the backend contract's own
  fixed `k=2`.
- Does not touch any other open Phase 3 chart item (chart modes beyond candlestick, timeframes
  beyond 1y/2y, trade execution markers, price levels for open orders, persisted chart
  preferences, user-configurable indicator parameters beyond period/signal-period).

## What changed

- `frontend/src/api/indicators.ts`: `IndicatorName` gains `"bollinger"`.
- `frontend/src/components/historyData.ts`: `parseBollingerPoints`, `IndicatorOverlay`'s two new
  optional fields, the `"bollinger"` branch in `indicatorOverlay()`.
- `frontend/src/components/DailyHistory.tsx`: two new band series, the `<option>`, prop/ref/effect
  wiring, `acceptHistory`/`alignedTimes`/`indicatorLabel`/`readIndicatorChoice` updates.
- `frontend/src/components/indicatorData.test.ts`: 6 new tests.
- `frontend/src/components/DailyIndicators.test.tsx`: 1 new end-to-end test.
- `docs/P3A_BOLLINGER_FRONTEND_VERIFICATION.md`: this document.
