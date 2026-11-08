# Additional history timeframes (1M, 3M, 6M, All) verification

Extends `app/services/market_history.py`'s `SUPPORTED_RANGES` from `{"1y", "2y"}` to six
tokens (`1m`/`3m`/`6m`/`1y`/`2y`/`all`), closing the remaining timeframe scope of the roadmap's
Phase 3 line "Historical timeframes: 1M, 3M, 6M, 1Y, 2Y, and All." `market_indicators.py`
inherits every new token automatically (it already calls `read_symbol_history` as a black
box); `performance_service.py`'s own separate, unrelated range concept was correctly left
untouched.

## Implemented by Grok, independently verified by me

`app/services/market_indicators.py` and `app/services/performance_service.py` are both
byte-identical to before this change. `"all"` is implemented as a fixed sentinel
(`date(1900, 1, 1)`), **not** a lookup of the symbol's actual earliest stored bar — correctly
relying on an existing guard rather than adding new code: `_coverage`'s own `try/except
ValueError` around `exchange_calendar.expected_session_dates(start, end)` already falls back to
`("not_verified", None)` when a window falls outside the calendar's supported range, exactly
what a multi-century window produces. The dispatch from six range tokens to their start-date
functions uses a module-level dict (`_RANGE_START`) rather than extending the previous
if/else chain into a six-way one, a clean, readable choice.

## A real test failure the diff itself didn't cause, caught by running the full suite

`python -m pytest -q` (full suite, not just the scoped test file) surfaced one failure:
`tests/test_market_indicators.py::test_route_text_bounds_missing_keys_and_history_detail`
had its own hardcoded copy of the old error string (`"range must be 1y or 2y."`), inherited
from `market_history.py`'s error message but living in a test file that was correctly outside
Grok's edit scope for this unit (it is `market_indicators.py`'s own test file, not
`market_history.py`'s). This is exactly the kind of cross-file consequence a scoped diff
review has to catch by actually running the full suite, not just the files in scope — fixed
directly (a one-line string-literal update to the already-reviewed, correct new message), not
re-delegated to another Grok round, since it was a trivial, unambiguous mechanical fix.

## Independent verification

- Re-derived the contract's three reference dates in a separate script before review:
  `one_month_before(2026-03-31) = 2026-02-28`, `three_months_before(2026-03-31) = 2025-12-31`,
  `six_months_before(2026-03-31) = 2025-09-30`. Matched exactly.
- Reviewed the full diff of both touched files directly (not Grok's self-report).
- `python -m pytest -q tests/test_market_history.py`: **28 passed** (25 pre-existing + 3 new).
- `python -m pytest -q` (full backend suite, after my one-line fix): **403 passed, 28
  skipped**, the same 2 pre-existing unrelated Windows-local SQLite-locking errors (documented
  since PR #27).
- Confirmed `app/services/market_indicators.py` and `app/services/performance_service.py` are
  byte-identical to before this change.

## What changed

- `app/services/market_history.py`: new `_months_before`/`one_month_before`/
  `three_months_before`/`six_months_before` helpers, `EARLIEST_SUPPORTED_DATE` sentinel,
  extended `SUPPORTED_RANGES`, updated validation error text, `_RANGE_START` dispatch dict.
- `tests/test_market_history.py`: 3 new tests, one existing test's expected error text updated.
- `tests/test_market_indicators.py`: one pre-existing assertion's hardcoded error string
  updated (fixed by me, not Grok, after the full-suite run surfaced it).
- `docs/P3_HISTORY_TIMEFRAMES_CONTRACT.md`: new contract, written by me before
  implementation, untouched by Grok.

## What this unit does not do

Does not change `performance_service.py`'s own, separate range concept. Does not compute
`"all"` from the symbol's true earliest stored bar. Backend only — the frontend
`HistoryRange` type and the range `<select>` in `DailyHistory.tsx` remain `"1y"`/`"2y"` only;
wiring the four new tokens into the frontend is a separate, following unit.
