# P3-A cached daily chart

Recorded 2026-11-06. The first cached daily-chart slice is accepted at `f1eb5a69f8a2622fb11dddca3cf5e3fe3df664f4`. Branch `codex/v2-cached-daily-chart-20261106`. PR 17 is stacked on PR 16: https://github.com/slowgold05/Fintech-trading-risk-engine/pull/17. No merge and no deployment. Pin and contract: [P3A_CHART_REVIEW.md](P3A_CHART_REVIEW.md). Open remainder of P3-A: [V2_BACKLOG.md](V2_BACKLOG.md).

## Implementation

Grok implemented the cached API client, strict validator, daily renderer, Home integration, unit and component tests, license assets, and the isolated browser adapter. Codex reviewed that work and added the Selenium chart journey.

The form requires a symbol and an explicit stored provider and adjustment. It reads cached daily bars only. This form makes no provider or research call and performs no ingestion or backfill. Raw and split-adjusted stay separate series. The client does not interpolate sessions or fabricate history. Empty, partial, failed, mismatched, and malformed results stay distinct.

The validator checks the full envelope even when `bars` is empty:

- Unique ascending real dates, and requested versus available bounds.
- Provenance and quality.
- Numeric(18,6) prices compared as scaled BigInt at six decimal places before conversion to chart numbers.
- Original decimal strings kept in an accessible table. Volume stays a string.
- A bad payload is rejected whole.

The chart pins `lightweight-charts` 5.2.1 and `fancy-canvas` 2.1.0. It uses `autoSize` and precision 6. An in-flight create is cancelled if the component unmounts before the dynamic import finishes, and the chart is removed on unmount. Refresh updates the existing chart. Unsent form edits do not reset it. A failed refresh removes the previous candles and table; Retry loads a new read.

Component tests cover unmount before the dynamic import completes, no constructor after unmount, a same-request refresh that does not construct another chart, and invalid, empty, and error states.

Attribution plus three public license and notice assets are packaged. Codex compared the Apache license bytes with the pinned upstream tag. `npm audit` is unchanged: 7 moderate, 0 high, 0 critical. No audit fix was applied.

The production build emits main bundle `index-CH_Ve0Lc.js` at 513.33 kB, with the existing 500 kB warning, and a lazy chart chunk of 197.50 kB.

## Browser journey

The journey uses the existing guarded loopback stack and synthetic `MarketSymbol` and `MarketBarDaily` rows. Provider HTTP is blocked. The `P3INVALID` adapter returns `close='NaN'` only from `isolated_api`, under an environment and module guard. It inserts no invalid database rows and changes no production endpoint.

It covers desktop and mobile canvas, explicit source switch, resize, refresh, error and Retry, empty and invalid payloads, notices, and navigation cleanup. Windows Selenium discovery remains blocked by Application Control. A local collector gathered 6 cases without launching a browser.

## Accepted head `f1eb5a69f8a2622fb11dddca3cf5e3fe3df664f4`

GitHub Actions run 42266086014: all 7 jobs passed.

- Frontend: 126 tests in 16 files. Lint and the production build passed.
- Backend: 190 passed, 2 skipped, 51.15 seconds. The two skips are optional browser modules inside the backend job. That job does not execute the browser journey.
- Browser job: 5 passed, 1 hosted case excluded, 68.30 seconds. This is the separate browser coverage.

The same renderer was already green on `e877659cd32808347fafa2ec3cc764c2082f26d9`, run 42265364763, all 7 jobs passed. Codex downloaded `.local-tools/ci-browser-42265364763/p3a-history` and viewed all five PNGs: real desktop and mobile candles with the original OHLC table; empty renders as unavailable; errors hide the previous candles and table; a malformed response is rejected and draws no chart. Resize, source switch, refresh, Retry, cleanup, and the three license assets passed in that journey.

Local checks on the accepted head: the isolation unit passed (1). The Impeccable detector returned `[]` for Home and DailyHistory.

## Still open

Indicator warm-up, a reviewed exchange calendar, provider approval, and live ingestion remain open. This acceptance covers the cached chart slice only.
