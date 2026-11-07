# P3-A cached daily SMA/EMA — chart integration verification

Accepted code `c93250bde11ebfafbb4a4f7bb3072ad28f0ac65b` on `codex/v2-indicator-chart-20261107`, stacked on ready [PR 25](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/25) at `d1753a9abd5e6da6e957677d3588e5dfd949f082`. Draft [PR 26](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/26). One Codex-authored browser-test correction, `1fd4e056920402036c82027628d6c912582ef5b3`, followed that application code. [CI 42389505205](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42389505205) is the final head's run: all 7 jobs succeeded. No formal GitHub approval is claimed. No merge or deploy. This note does not close full P3-A, the exchange calendar, other indicators, or any other roadmap item.

## Accepted code CI

Backend, Python 3.12, fresh PostgreSQL 17: 303 passed, 7 skipped, 916 warnings, 117.54s. Frontend: 300 tests in 26 files; lint and build passed. Browser: 10 passed, 1 hosted case excluded, 109 warnings, 133.71s. That ten-test count includes `test_indicator_overlay_ui`, the new chart-integration journey. Security, static analysis, dependency, and secrets jobs passed with the rest of the seven.

## The browser-test correction

[CI 42387988642](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42387988642) at `c93250b` failed `test_indicator_overlay_ui` at `tests/browser/test_p3a_indicators_ui.py:192`: Selenium `.text` returned CSS-transformed uppercase header text, not the DOM label. Grok's fix to `_headers` (reading `textContent` instead of `.text`) is already in `c93250b` per the prior checkpoint.

A documentation-only head, `7fa19ad`, reran that same test on [CI 42388804956](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42388804956) and reached a second, later failure: a timeout at line 220, `_wait_prices(driver, ["Warm-up"] * 6, "SMA (20)")`. At that point in the test the indicator select is still `ema`, left over from the prior EMA(3) step; the period field is then set to `20` and submitted without switching the indicator back to `sma`. The backend's indicator service (`app/services/market_indicators.py`) echoes back whatever `name` was requested, so an insufficient-data response for `ema` at period 20 correctly labels its column `EMA (20)`. The test's hardcoded `"SMA (20)"` expectation was a leftover from an earlier draft, not an application defect.

Codex traced this directly from the CI log and corrected the one line (`"SMA (20)"` to `"EMA (20)"`) rather than writing a Grok brief, since the root cause was already fully diagnosed from the failing assertion and the surrounding test flow. [CI 42389505205](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42389505205) on `1fd4e05` is the first green run of this test. No application source changed in that commit.

## Browser evidence

Codex downloaded the `browser-screenshots` artifact from CI 42389505205 and viewed all six `p3a-indicators-ui` captures: `sma-desktop`, `sma-table`, `ema-desktop`, `insufficient`, `sma-mobile`, and `error`.

`sma-desktop` and `sma-table` show SMA(3) candles and the full session-price table: the first two rows (`2026-10-08`, `2026-10-10`) read `Warm-up`, and the remaining four match the fixture (`2.333333`, `4.666667`, `4.333333`, `6.666667`). `ema-desktop` shows EMA(3) on the same candles with a value that diverges from SMA after the seed (`6.541667` versus `6.666667` on the final point), confirming the two indicators are not accidentally equal. `insufficient` shows EMA(20) against six observed closes: the explanatory text reads "Insufficient stored closes for this period" and "Warm-up: the first 19 observed stored closes have no indicator value," the column header reads `EMA (20)`, and all six rows read `Warm-up` with no `0.000000` placeholder — this is the exact state the corrected assertion checks. `sma-mobile` shows the 390px layout with the chart and form fitting inside the viewport and the table remaining scrollable. `error` shows the unknown-symbol case: indicator reset to `None`, an alert reading "This symbol is not in the cached symbol list," and a Retry control, with no stale chart or table.

## Boundaries

No pricing, execution, private account, authentication, dependency, migration, grant, provider-ingestion, or scheduler change. No second SQL read; the indicator response still nests the one original `read_symbol_history` result consumed in [P3A_INDICATOR_CONTRACT.md](P3A_INDICATOR_CONTRACT.md). The mounted-only unknown-order retry still drops its intent on reload or unmount; that remains a release gate.

## Next

Full P3-A (the reviewed exchange calendar) and full P3-B stay open. Remaining chart modes, timeframes, volume, other indicators, preferences, overlays, provider decisions, P4 analytics, P5 research, P6 forecasts, and release work remain open. This note checks no roadmap box.
