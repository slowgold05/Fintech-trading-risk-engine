# P3-A pinned chart review

Written 2026-11-06. Codex reviewed this pin before implementation. `lightweight-charts` **5.2.1** is a deliberate pin. This note does not call that version latest or current.

Implementation status, 2026-11-06: the cached daily-chart slice is installed and accepted at `f1eb5a69f8a2622fb11dddca3cf5e3fe3df664f4`. Results are in [P3A_HISTORY_VERIFICATION.md](P3A_HISTORY_VERIFICATION.md). The reviewed prerequisites in this note are fulfilled for that cached slice. Indicator warm-up, a reviewed exchange calendar, and provider ingestion remain open. This is not full P3-A, Phase 1, or Phase 3 acceptance. Provider approval is not implied.

Existing P1-B history schema and [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md) cached reads bound this read-only slice. [V2_BACKLOG.md](V2_BACKLOG.md) P3-A required this review before the package. The accepted slice contains the package, lockfile, and chart source. Three license and notice files are packaged, and Codex compared them with the primary sources below. Provider ingestion and the exchange session calendar remain gated. This note records no hosted deployment.

## Primary sources

Codex inspected these pin-tag pages. This note relies on that inspection. It does not re-fetch them, and it does not copy upstream license text.

- Release: https://github.com/tradingview/lightweight-charts/releases/tag/v5.2.1
- License: https://github.com/tradingview/lightweight-charts/blob/v5.2.1/LICENSE — Apache License 2.0. The README states that incorporated `tslib` portions are under the BSD Zero Clause License.
- Notice: https://github.com/tradingview/lightweight-charts/blob/v5.2.1/NOTICE — TradingView Lightweight Charts trademark; Copyright (c) 2025 TradingView, Inc.; https://www.tradingview.com/
- Readme: https://github.com/tradingview/lightweight-charts/blob/v5.2.1/README.md — put the NOTICE attribution and a TradingView link on a user-accessible page. The `attributionLogo` option satisfies the link requirement. It does not satisfy the whole notice.
- API skill: https://github.com/tradingview/lightweight-charts/blob/v5.2.1/.github/skills/lightweight-charts/SKILL.md
- fancy-canvas 2.1.0 license: https://github.com/tradingview/fancy-canvas/blob/a5e954d0d8da5835ac22a5114e65c1e8c227ed66/LICENSE — MIT. Upstream license commit for the packaged copy; the npm tarball omits this text.

Local contract evidence: [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md) and [V2_BACKLOG.md](V2_BACKLOG.md) P3-A. The history route is the public cached read `GET /market/symbols/{symbol}/history`.

## License, NOTICE, creator link, and v5 lifetime

Distribution must keep the exact `LICENSE` and `NOTICE` bytes from tag `v5.2.1`. Do not rewrite them into this note or into a paraphrase in the bundle. The chart page must show creator credit and a TradingView link near the chart, and it must enable the link-bearing `attributionLogo` option. Confirm that option's name and default against the installed package types before shipping it. Credit is attribution. Do not state or imply TradingView endorsement of Sentinel Markets. Apache-2.0 plus the README's BSD Zero Clause note for `tslib` portions is the license record for this pin.

Follow the v5.2.1 skill. Do not use v4 series methods. Create the chart once in a `useEffect`: call `createChart`, add one series with `addSeries(CandlestickSeries, ...)`, and clean up with `chart.remove()` on unmount. Do not create a second chart for the same container. Use `autoSize` so a `ResizeObserver` owns resize. Do not keep a separate window-resize chart lifecycle. Import types from the installed `lightweight-charts` package and check them. Do not hand-write ambient types to match this note. Bar time is an ascending, unique BusinessDay `YYYY-MM-DD` taken from `session_date`. Do not insert weekend or holiday points. Do not pass null or NaN. Do not use `fetched_at` as the bar time. The accepted cached slice follows this lifetime.

## Explicit provider, adjustment, and partial data

One read-only daily candlestick chart of available canonical bars. This is not an account-performance curve, not `/portfolio` valuation, not a sparkline, and not `price_history_daily` or `market_quote_cache`.

`GET /market/symbols/{symbol}/history?interval=1d&range=2y&provider={provider}&adjustment_type={raw|split_adjusted}`

`interval=1d` and `range=2y` are fixed. `provider` and `adjustment_type` are required arguments. No default provider, no default adjustment, and no blend of `raw` with `split_adjusted`. One response is one series. A series switch replaces the previous series; it does not concatenate. Plot only bars from that response as one `CandlestickSeries` (open, high, low, close). Volume stays in the payload and is not a second series in this slice.

Show the response as it is. `status` is `unavailable` or `partial`. The API never returns `complete`. Do not relabel a partial series as complete or as two-year coverage. `coverage_status` is `not_verified`. `expected_session_count` is null. `collection` is `disabled` (canonical-history ingestion is off; this is not the quote-refresh path). Show `excluded_row_count`, `provider`, `adjustment_type`, `available_start`, `available_end`, `requested_start`, and `requested_end`. Missing sessions inside the window stay missing. The client does not fill them.

Empty, failed, 404, 422, and `bars: []` render an explicit empty or error state. They do not draw a generated curve. Before `setData`, reject the payload if any bar is malformed, non-finite, or OHLC-invalid, or if session dates repeat or are out of order. Do not pass those bars through and rely on the library to skip bad prices. Do not drop the bad rows and plot the rest as a clean series. Decimal strings stay decimal until this chart boundary. Conversion to chart numbers happens only there, for display. Backend money quantization and storage stay unchanged. Rejected or converted chart numbers are never written back. The call is the existing cached GET. No provider client, ingestion writer, backfill, or other write.

## Install and license files

Done for the cached slice on 2026-11-06. `lightweight-charts` 5.2.1 is the exact pin, with `fancy-canvas` 2.1.0. Exported types, `createChart`, `addSeries`, `CandlestickSeries`, `autoSize`, and `attributionLogo` are taken from that install. Three public license and notice files are in the slice. Codex compared those files with the primary sources in this note, including the Apache license bytes from tag `v5.2.1`. That comparison is attribution hygiene. It is not a provider entitlement and it is not full P3-A acceptance. Indicator warm-up, exchange-calendar session-gap semantics, and intraday stay outside this slice.

## Tests and browser

Executed. The pass is recorded in [P3A_HISTORY_VERIFICATION.md](P3A_HISTORY_VERIFICATION.md), at `f1eb5a69f8a2622fb11dddca3cf5e3fe3df664f4`, CI run 42266086014, all 7 jobs passed. That run covers this note's contract: ascending unique dates, whole-payload refusal, distinct empty and error states, an explicit provider and adjustment, one-chart refresh and unmount, and decimal conversion only at the chart boundary.

Codex viewed the five chart PNGs from the same renderer on run 42265364763. The Linux browser job is the browser proof. Local Windows Selenium discovery stayed blocked by Application Control (`WinError 4551`); that blocker was not bypassed. Full P3-A remains open.
