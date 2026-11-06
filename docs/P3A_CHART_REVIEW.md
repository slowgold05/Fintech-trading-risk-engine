# P3-A pinned chart review

Written 2026-11-06. Codex has reviewed this note. The pinned review is complete and is the technical prerequisite for a cached-only daily chart. Installation and implementation remain next. `lightweight-charts` **5.2.1** is a deliberate pin. This note does not call that version latest or current. The package is not installed and the chart is not implemented. This is not P3-A acceptance, Phase 1 completion, or Phase 3 completion. Provider approval is not implied.

Existing P1-B history schema and [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md) cached reads allow this bounded read-only slice. [V2_BACKLOG.md](V2_BACKLOG.md) P3-A forbids a new package before this review. `frontend/package.json` has no chart dependency. Provider ingestion and the exchange session calendar remain gated. No source, package, lockfile, or hosted change is in this note.

## Primary sources

Codex inspected these pin-tag pages. This note relies on that inspection. It does not re-fetch them, and it does not copy upstream license text.

- Release: https://github.com/tradingview/lightweight-charts/releases/tag/v5.2.1
- License: https://github.com/tradingview/lightweight-charts/blob/v5.2.1/LICENSE — Apache License 2.0. The README states that incorporated `tslib` portions are under the BSD Zero Clause License.
- Notice: https://github.com/tradingview/lightweight-charts/blob/v5.2.1/NOTICE — TradingView Lightweight Charts trademark; Copyright (c) 2025 TradingView, Inc.; https://www.tradingview.com/
- Readme: https://github.com/tradingview/lightweight-charts/blob/v5.2.1/README.md — put the NOTICE attribution and a TradingView link on a user-accessible page. The `attributionLogo` option satisfies the link requirement. It does not satisfy the whole notice.
- API skill: https://github.com/tradingview/lightweight-charts/blob/v5.2.1/.github/skills/lightweight-charts/SKILL.md

Local contract evidence: [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md) and [V2_BACKLOG.md](V2_BACKLOG.md) P3-A. The history route is the public cached read `GET /market/symbols/{symbol}/history`.

## License, NOTICE, creator link, and v5 lifetime

Distribution must keep the exact `LICENSE` and `NOTICE` bytes from tag `v5.2.1`. Do not rewrite them into this note or into a paraphrase in the bundle. The chart page must show creator credit and a TradingView link near the chart, and it must enable the link-bearing `attributionLogo` option. Confirm that option's name and default against the installed package types before shipping it. Credit is attribution. Do not state or imply TradingView endorsement of Sentinel Markets. Apache-2.0 plus the README's BSD Zero Clause note for `tslib` portions is the license record for this pin.

Follow the v5.2.1 skill. Do not use v4 series methods. Create the chart once in a `useEffect`: call `createChart`, add one series with `addSeries(CandlestickSeries, ...)`, and clean up with `chart.remove()` on unmount. Do not create a second chart for the same container. Use `autoSize` so a `ResizeObserver` owns resize. Do not keep a separate window-resize chart lifecycle. After install, import types from the installed `lightweight-charts` package and check them. Do not hand-write ambient types to match this note. Bar time is an ascending, unique BusinessDay `YYYY-MM-DD` taken from `session_date`. Do not insert weekend or holiday points. Do not pass null or NaN. Do not use `fetched_at` as the bar time.

## Explicit provider, adjustment, and partial data

One read-only daily candlestick chart of available canonical bars. This is not an account-performance curve, not `/portfolio` valuation, not a sparkline, and not `price_history_daily` or `market_quote_cache`.

`GET /market/symbols/{symbol}/history?interval=1d&range=2y&provider={provider}&adjustment_type={raw|split_adjusted}`

`interval=1d` and `range=2y` are fixed. `provider` and `adjustment_type` are required arguments. No default provider, no default adjustment, and no blend of `raw` with `split_adjusted`. One response is one series. A series switch replaces the previous series; it does not concatenate. Plot only bars from that response as one `CandlestickSeries` (open, high, low, close). Volume stays in the payload and is not a second series in this slice.

Show the response as it is. `status` is `unavailable` or `partial`. The API never returns `complete`. Do not relabel a partial series as complete or as two-year coverage. `coverage_status` is `not_verified`. `expected_session_count` is null. `collection` is `disabled` (canonical-history ingestion is off; this is not the quote-refresh path). Show `excluded_row_count`, `provider`, `adjustment_type`, `available_start`, `available_end`, `requested_start`, and `requested_end`. Missing sessions inside the window stay missing. The client does not fill them.

Empty, failed, 404, 422, and `bars: []` render an explicit empty or error state. They do not draw a generated curve. Before `setData`, reject the payload if any bar is malformed, non-finite, or OHLC-invalid, or if session dates repeat or are out of order. Do not pass those bars through and rely on the library to skip bad prices. Do not drop the bad rows and plot the rest as a clean series. Decimal strings stay decimal until this chart boundary. Conversion to chart numbers happens only there, for display. Backend money quantization and storage stay unchanged. Rejected or converted chart numbers are never written back. The call is the existing cached GET. No provider client, ingestion writer, backfill, or other write.

## Install next

Not run. From `frontend/`: `npm install lightweight-charts@5.2.1 --save-exact`. Then confirm `package.json` and the lockfile pin `5.2.1` exactly, and check exported types, `createChart`, `addSeries`, `CandlestickSeries`, `autoSize`, and `attributionLogo` against the installed package. No `@latest`. No other chart library in that step. No chart component, route, or client history adapter exists yet. Full P3-A acceptance stays open: indicator warm-up, exchange-calendar session-gap semantics, and intraday are outside this slice.

## Test and browser plan

Not run. No pass is claimed. Vitest, on a fixture response, with no network and no chart package required until the install lands:

- Valid bars become ascending unique `YYYY-MM-DD` candlestick points. No weekend filler. No null or NaN.
- Malformed, non-finite, invalid OHLC, duplicate dates, and out-of-order dates refuse `setData`.
- Empty, unavailable, failed, 404, and 422 draw no series and no synthetic curve.
- `provider` and `adjustment_type` are required. A switch loads only the newly requested series.
- The view shows partial or unavailable, `not_verified`, `collection: disabled`, `excluded_row_count`, and the selected source. It does not claim a full two-year history.
- Decimal-to-number conversion stays at the chart boundary.
- Mount creates one chart. Unmount calls `chart.remove()` once. Data refresh does not construct a second chart.

Headless browser, after implementation, on the existing designated-account journey and a mobile viewport: unavailable, partial, failed, and invalid-bar states; resize under `autoSize`, then unmount by leaving the route; series switch across an explicit provider or adjustment, with the prior series gone; source, coverage, collection, and excluded count visible; creator credit, TradingView link, and the link-enabled attribution logo visible near the chart; no account-performance curve and no two-year completeness claim. Local Selenium remains subject to the Windows Application Control blocker already recorded for the P2 overview (`WinError 4551`). A later headless Linux CI run is the browser proof. This note does not execute it.
