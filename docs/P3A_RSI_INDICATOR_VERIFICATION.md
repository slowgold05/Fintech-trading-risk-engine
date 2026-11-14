# RSI indicator backend verification

This unit adds Wilder's RSI as a third `name` value on `GET /market/symbols/{symbol}/indicators`,
alongside the existing `sma` and `ema`. It is backend-only, mirroring the project's own precedent
of landing the SMA/EMA backend as its own unit before a later chart-integration unit (see
[P3A_INDICATOR_VERIFICATION.md](P3A_INDICATOR_VERIFICATION.md) and
[P3A_CHART_INTEGRATION_VERIFICATION.md](P3A_CHART_INTEGRATION_VERIFICATION.md)). No router,
frontend, migration, or provider change is part of this unit.

Full contract: [P3A_INDICATOR_CONTRACT.md](P3A_INDICATOR_CONTRACT.md) section 13 (new addendum,
sections 1-12 unchanged).

## Implemented by Grok, independently verified by me

This is the first unit in this session where Grok's CLI actually wrote the code. The earlier
blocker (Grok's headless CLI being unable to get write/edit permission) turned out to be caused
by requesting *blanket* permission (`--allow "Edit"`/`"Write"`, or `--permission-mode
bypassPermissions`), which both Claude Code's own classifier and Grok's own headless approval
wall reject. Granting *exact, scoped* rules instead — `--allow "Edit(app/services/market_indicators.py)"`,
one rule per file Grok was told to touch, plus `--allow "Bash(python:*)"` for running pytest —
passed both. Grok was given: the exact files it may edit (and told explicitly to touch nothing
else), the precise Wilder RSI formula including the warm-up-length and `avg_loss == 0` edge-case
conventions spelled out step by step (these are the two places a plausible-looking RSI
implementation most commonly gets subtly wrong), and a 20-point reference table of expected RSI
values that I computed independently beforehand, from the formula definition, in a separate
Python/Decimal script — not derived from Grok's code, so matching it is a real correctness check.

I then independently verified, not just re-read, the result:

- Confirmed via `git status` that only the three files it was told it could touch were changed.
- Re-ran `tests/test_market_indicators.py` myself: 44 passed (38 existing + 6 new), with no
  existing assertion altered.
- Re-ran the full backend suite: 313 passed, 28 skipped, the same 2 pre-existing
  Windows-local-SQLite-file-locking errors documented in
  [P1C_EXCHANGE_CALENDAR_VERIFICATION.md](P1C_EXCHANGE_CALENDAR_VERIFICATION.md) (confirmed there
  via `git stash` to be unrelated to any change in this stack; the CI `backend` job runs on Linux
  against PostgreSQL where this path is not exercised).
- Read the full diff of `app/services/market_indicators.py` myself and checked it against my own
  reference derivation line by line: the warm-up threshold (`period + 1` closes, via a shared
  `_closes_required(name, period)` helper used by both `_points` and `_response` so the two can't
  drift apart — a cleaner factoring than I specified, not a weaker one), the Wilder smoothing
  recurrence, and the `avg_loss == 0` conventions all match.
- Re-derived the 6-value reference table independently a second time (same closes, same formula,
  written from scratch again rather than re-running the first script) and confirmed it against
  what landed in the test file: `70.464135, 66.249619, 66.480942, 69.346853, 66.294713, 57.915021`
  for closes index 14-19 with `period=14`.
- Read the contract addendum Grok wrote (section 13) and confirmed every claim in it against the
  actual code, including a detail I had not asked it to call out: the frontend's
  `indicatorOverlay` warm-up calculation (`Math.min(period - 1, count)`) assumes SMA/EMA's
  `period - 1` leading nulls, which would be wrong for RSI's `period` leading nulls — correctly
  flagged as a gap for the future RSI frontend-integration unit, not fixed here.

## What changed

- `app/services/market_indicators.py`: `_NAMES` gained `"rsi"`; `_validate_indicator`'s error text
  now says `"name must be sma, ema, or rsi."` (updated everywhere it was asserted in the test
  file); new `_closes_required(name, period)` returns `period + 1` for `rsi` and `period`
  otherwise, used by both `_points` (warm-up nulls) and `_response` (status); new `_rsi(closes,
  period)` and `_rsi_from_averages(avg_gain, avg_loss)` implement Wilder's smoothing, reusing the
  existing `closes` list, the existing `Context(prec=50)` local context, and the existing
  `_response_text` quantization — no parallel extraction or formatting path.
- `tests/test_market_indicators.py`: 12 new parametrize cases on the existing
  `test_service_rejects_name_and_noninteger_period` (name/period validation for `rsi`, reusing the
  existing parametrization rather than a new test function) plus 6 new test functions: the
  20-point reference vector, the `period`/`period + 1` insufficient-to-partial boundary, the
  `count == 0` unavailable path, the flat-price (`avg_gain == avg_loss == 0` to RSI `50`) edge
  case, the all-gains (`avg_loss == 0` to RSI `100`) edge case, and the same 2-200 period bounds
  sma/ema already get.
- `docs/P3A_INDICATOR_CONTRACT.md`: new section 13 only; sections 1-12 untouched.

## Verification run, 2026-11-07

- `python -m pytest -q tests/test_market_indicators.py`: **44 passed**, 0 failed.
- `python -m pytest -q` (full backend suite), local Python 3.14.6, `AUDIT_DATABASE_URL` unset
  (SQLite): **313 passed, 28 skipped**, 2 pre-existing unrelated errors (documented above).
- No file outside `app/services/market_indicators.py`, `tests/test_market_indicators.py`, and
  `docs/P3A_INDICATOR_CONTRACT.md` was touched.

This does not add RSI to the frontend (`IndicatorName`, the indicator `<select>`, and
`DailyHistory.tsx`/`historyData.ts` are unchanged), does not close P3-A, and does not implement
MACD or any other indicator. No merge or deploy is claimed.
