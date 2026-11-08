# Bollinger Bands verification

Adds `bollinger` as a fifth `name` value on `GET /market/symbols/{symbol}/indicators`. Closes
the Phase 3 roadmap's "SMA, EMA, Bollinger Bands, RSI, and MACD" indicator line item — the one
remaining open item on that line (SMA, EMA, RSI, and MACD already shipped, PRs #30-35). Design
written first as contract section 15 (`docs/P3A_INDICATOR_CONTRACT.md`), following the exact
pattern RSI (section 13) and MACD (section 14) each used: `period` reused as the moving-average
window, band-width multiplier fixed at `2` (not configurable), middle band identical to the
existing SMA, additive-only response shape for every other `name`.

## Implemented by Grok, independently verified by me

Refactored `_sma` into `_sma(closes, period)` (quantized text, unchanged external behavior) plus
a new `_sma_decimals(closes, period)` (unrounded `Decimal` values) — the exact `_ema`/
`_ema_decimals` split this file already used for EMA, applied to SMA for the first time because
Bollinger needs the *unrounded* mean for its variance calculation, not the quantized SMA text.
The new `_bollinger(closes, period)` calls `_sma` for the middle-band text (so it is provably
identical to what `name="sma"` would already return for the same inputs, not a second,
independently-computed mean that could silently diverge) and `_sma_decimals` for the unrounded
mean used in `variance = sum((x - mean) ** 2 for x in window) / period` — **population**
variance, dividing by `period`, matching the contract. `stdev = variance.sqrt()` inside the
existing `Context(prec=50)` `localcontext`. Wired into `_points`'s `name == "bollinger"` branch,
mirroring the existing `macd` branch's structure in both the insufficient-closes early return
and the main computation branch.

Independent verification: re-derived the full reference table (closes `[10, 12, 11, 13, 14, 12,
15]`, period 3) in a separate `Decimal`/`Context(prec=50)` script before review — all five
non-null points (`"11.000000"/"12.632993"/"9.367007"` through `"13.666667"/"16.161105"/
"11.172228"`) matched Grok's test exactly. `git status`/`git diff` confirmed only the 2 scoped
files changed; `docs/P3A_INDICATOR_CONTRACT.md`'s diff is my own pre-implementation section 15
addition (91 insertions), untouched by Grok. Confirmed the `name == "sma"` branch in `_points`
still calls the unchanged `_sma` signature, so SMA's own output is byte-identical to before this
refactor.

- `python -m pytest -q tests/test_market_indicators.py`: **75 passed** (59 existing + 16 new/
  extended).
- `python -m pytest -q` (full backend suite): **364 passed, 28 skipped**, 2 pre-existing
  unrelated Windows-local SQLite-locking errors documented since PR #27.
- No file outside `app/services/market_indicators.py` and `tests/test_market_indicators.py` was
  touched.

## What changed

- `app/services/market_indicators.py`: `_NAMES`/error detail extended; `_closes_required`
  given an explicit `bollinger` branch; `_sma` split into quantized/unrounded forms; new
  `_bollinger`; `_points` given a `bollinger` branch in both code paths.
- `tests/test_market_indicators.py`: `_NAME_DETAIL` and the parametrized rejection test extended
  with `bollinger` cases; four new tests (reference vector, insufficient-until-period,
  unavailable-with-no-closes, same period bounds as SMA); the existing shape-completeness test
  extended to cover `macd` and `bollinger` alongside `sma`/`ema`/`rsi`.
- `docs/P3A_INDICATOR_CONTRACT.md`: new section 15, written by me before implementation,
  untouched by Grok.

## What this unit does not do

Backend only — the frontend `IndicatorName` type, the indicator `<select>`, and
`historyData.ts`'s overlay builder are unchanged; `upper`/`lower` are not yet parsed or plotted
anywhere in the frontend. No configurable band-width multiplier. No chart-integration design
(rendering Bollinger Bands as a shaded band around price, unlike RSI/MACD's own sub-panel,
remains a separate, later unit). No merge or deploy is claimed.
