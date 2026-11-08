# Additional history timeframes (1M, 3M, 6M, All) — contract

Roadmap Phase 3 line: "Historical timeframes: 1M, 3M, 6M, 1Y, 2Y, and All." Only `1y`/`2y` are
supported today (`app/services/market_history.py`'s `SUPPORTED_RANGES`). Written before
implementation.

## Scope

Extend `SUPPORTED_RANGES` and the `range_token → start date` dispatch in
`app/services/market_history.py` only. `app/services/market_indicators.py` already calls
`read_symbol_history` as a black box for its own range handling, so it inherits every new
token automatically with no change of its own. `performance_service.py`'s own separate
`range`/`SUPPORTED_RANGES` (used by `GET /portfolio/performance` and
`GET /portfolio/risk-metrics`) is a **different, unrelated** range concept (portfolio
performance windows, not chart history) and is explicitly **out of scope** — do not touch it.

## New tokens and their start-date computation

```
"1m"  → one calendar month before the clock date, day-of-month clamped to the target
        month's last valid day (e.g. 2026-03-31 → 2026-02-28, not 2026-02-31)
"3m"  → three calendar months before, same clamping rule
"6m"  → six calendar months before, same clamping rule
"1y"  → unchanged (one_calendar_year_before, already implemented)
"2y"  → unchanged (two_calendar_years_before, already implemented)
"all" → a fixed sentinel date far before any realistic market data, date(1900, 1, 1)
```

`"all"` is deliberately **not** a lookup of the symbol's actual earliest stored bar — it is a
fixed, very early `start` fed into the exact same SQL range filter and coverage-comparison
logic every other range token already uses. This works correctly with no special-casing
because of a guard already in this file: `_coverage(start, end, bars)` already wraps its
`exchange_calendar.expected_session_dates(start, end)` call in `try/except ValueError`,
falling back to `(COVERAGE_STATUS, None)` = `("not_verified", None)` when the window falls
outside the calendar's supported range — exactly what a multi-century window does. That
fallback was written generally ("the guard stays honest rather than assuming that can't
change"), not specifically for this unit, but it already covers this case correctly with zero
new code. The actual returned `bars` are unaffected either way — the SQL filter
(`session_date >= start AND session_date <= end`) simply returns whatever rows exist in that
very wide window, which is exactly "all" should mean.

## Month-arithmetic helper

A new `_months_before(day: date, months: int) -> date` helper (using `calendar.monthrange` to
find the target month's last valid day, clamping `day.day` to it) backs `one_month_before`,
`three_months_before`, `six_months_before` — three thin wrappers calling it with
`months=1/3/6`, the same thin-wrapper style `one_calendar_year_before`/
`two_calendar_years_before` already establish (one function per token, not a single
parameterized function exposed at the call site, to keep every public function's name
self-documenting).

## Validation

`_validate_history_query`'s `range_token not in SUPPORTED_RANGES` check and its error detail
message both update to list all six tokens: `"range must be 1m, 3m, 6m, 1y, 2y, or all."`

## Worked reference (independently verified, not derived from the implementation)

Clock date `2026-03-31` (deliberately chosen to exercise the day-of-month clamping rule in
both directions):

```
one_month_before(2026-03-31)   = 2026-02-28  (February has 28 days in 2026, not a leap year)
three_months_before(2026-03-31) = 2025-12-31  (December has 31 days, no clamping needed)
six_months_before(2026-03-31)   = 2025-09-30  (September has 30 days, clamped from 31)
```

Independently verified with a standalone script before implementation (direct calendar-month
arithmetic, not derived from the code under test):

```python
import calendar
from datetime import date

def months_before(day, months):
    total = day.year * 12 + (day.month - 1) - months
    year, month = divmod(total, 12)
    month += 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day.day, last_day))

months_before(date(2026, 3, 31), 1)  # -> date(2026, 2, 28)
months_before(date(2026, 3, 31), 3)  # -> date(2025, 12, 31)
months_before(date(2026, 3, 31), 6)  # -> date(2025, 9, 30)
```

## What this unit does not do

Does not change `performance_service.py`'s own, separate `range` concept (portfolio
performance/risk-metrics windows). Does not compute `"all"` as the symbol's true earliest
stored bar — a fixed sentinel date, relying on the existing SQL filter and coverage fallback
guard to produce the correct, honest result with no new logic. Does not change
`market_indicators.py` (inherits the new tokens automatically). This contract covers the
backend only; frontend wiring (the `HistoryRange` type and the range `<select>` in
`DailyHistory.tsx`) is a separate, following unit.
