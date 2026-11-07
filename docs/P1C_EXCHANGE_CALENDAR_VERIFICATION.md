# Reviewed exchange calendar verification

This unit adds a local, stdlib-only NYSE trading-day calendar and uses it to compute real
`coverage_status` and `expected_session_count` values for
`GET /market/symbols/{symbol}/history`. It does not touch `GET /market/data-status`, which
keeps its unconditional `"not_verified"`/`null` pair (see [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md)).
No provider, dependency, migration, grant, or scheduler change is part of this unit.

## Why hand-rolled, not a library

No third-party calendar package (`pandas_market_calendars`, `exchange_calendars`, or similar)
was added. The codebase already hand-rolls its financial math (Decimal SMA/EMA) rather than
pulling in libraries, for auditability and zero new supply-chain surface. `app/services/exchange_calendar.py`
uses only `datetime` and integer arithmetic.

## Holiday rules implemented and their historical references

Every reference date below was checked against a primary NYSE announcement or a contemporaneous
news report, not derived from this module's own logic — see the citations inline in
`tests/test_exchange_calendar.py` and the summaries here:

| Rule | Reference check |
| --- | --- |
| Weekends | Always non-trading, independent of any holiday. |
| New Year's Day, observed (Sat->Fri, Sun->Mon) | Standard shift, with two confirmed Rule 7.2 exceptions below. |
| Martin Luther King Jr. Day | Full closure only from 1998 onward. 1997-01-20 (3rd Monday) was a normal trading day; 1998-01-19 (3rd Monday) was NYSE's first full MLK closure. Confirmed via SEC press release (1997-06-05) announcing the floor would close each January from then on, and contemporaneous reporting that 1998 was the first year it took effect. |
| Washington's Birthday / Presidents Day | 3rd Monday of February, standard. |
| Good Friday | Computed via the anonymous Gregorian (Gauss) Easter algorithm, minus 2 days. Checked against the official NYSE Group holiday-calendar press releases: closed 2021-04-02, 2022-04-15, 2023-04-07. All three match the algorithm exactly. |
| Memorial Day | Last Monday of May, standard. |
| Juneteenth | Observed only from 2022 onward. 2021-06-18 (the Friday before June 19, 2021, a Saturday) traded normally — NYSE did not observe Juneteenth that year. 2022-06-20 (observed Monday, since June 19, 2022 fell on a Sunday) was closed. Confirmed via NYSE's 2022-2023-2024 holiday calendar press release (2021-12-27) and contemporaneous reporting on the 2021 non-observance. |
| Independence Day, observed (Sat->Fri, Sun->Mon) | Checked against three independent cases: 2009-07-03 closed (July 4, 2009 was a Saturday), 2021-07-05 closed (July 4, 2021 was a Sunday), 2026-07-03 closed (July 4, 2026 is a Saturday, per NYSE's own forward calendar). All three match. |
| Labor Day | 1st Monday of September, standard. |
| Thanksgiving | 4th Thursday of November, standard. |
| Christmas, observed (Sat->Fri, Sun->Mon) | Standard shift. |

### Confirmed Rule 7.2 discretionary exception: December 31

NYSE Rule 7.2 has, on at least two confirmed occasions, kept December 31 open instead of
observing New Year's Day early when the following January 1 fell on a Saturday:

- 2010-12-31 stayed open even though 2011-01-01 was a Saturday (confirmed: Bloomberg reporting
  referenced this as the prior instance of the quirk, "11 years ago" relative to the 2021 case).
- 2021-12-31 stayed open even though 2022-01-01 was a Saturday (confirmed: NYSE's own 2021
  calendar listed December 31, 2021 as "OPEN," and multiple contemporaneous reports attributed
  this to Rule 7.2 and "unusual business conditions" / quarter-end accounting).

This is a discretionary Board decision, documented as such everywhere it was reported — it is
**not** a general rule applied automatically every time January 1 falls on a Saturday. The
module hardcodes only these two confirmed years (`_NEW_YEARS_OBSERVANCE_WAIVED_YEARS = {2011, 2022}`,
keyed by the January whose Jan-1-Saturday was waived). Every other year in the 1990-2035
supported range where January 1 falls on a Saturday uses the standard observed-Friday-closed
shift as a documented **default**, which is explicitly **not independently confirmed** for
those other years — a future correction may be needed if a third instance of this discretionary
waiver is found.

## What `coverage_status` does and does not mean

`coverage_status` on `/market/symbols/{symbol}/history` compares the set of returned (valid,
in-window) session dates against the set of calendar-expected NYSE trading days in
`[requested_start, requested_end]`:

- `"complete"` — the two sets are equal.
- `"gaps"` — expected sessions are missing from what was returned, nothing extra.
- `"unexpected_sessions"` — a returned session falls on a day the calendar says is non-trading,
  nothing is missing.
- `"gaps_and_unexpected_sessions"` — both at once.
- `"not_verified"` — the requested window fell outside the calendar's 1990-2035 supported range
  (`expected_session_count` is `null` in this case only). This does not happen for the
  application's normal "today minus two calendar years" window; it is a defensive fallback.

**This is a comparison against the standard annual NYSE holiday schedule only.** It does not
know about irregular ad hoc closures (September 11, 2001, weather, exchange system outages, or
any other one-off closure outside the fixed annual rules above). A `"complete"` result means
"matches the standard schedule," not "every historically accurate trading day is accounted for."
This mismatch reporting is read-only: it never filters, drops, or alters any returned bar — an
"unexpected" stored session is still returned in `bars` exactly as stored.

`GET /market/data-status`'s `coverage_status`/`expected_session_count` are unaffected and stay
`"not_verified"`/`null` unconditionally — that route has no single symbol's stored sessions to
compare against a specific window, so a future unit would need to define what "coverage" even
means there before changing it.

## Files changed

- `app/services/exchange_calendar.py` (new): the calendar module described above.
- `app/services/market_history.py`: `_symbol_history` now calls a new `_coverage` helper
  instead of hardcoding `COVERAGE_STATUS`/`None`. `_data_status` is untouched.
- `frontend/src/api/history.ts`: `HistoryResponse.coverage_status` is now the
  `HistoryCoverageStatus` union (5 values) instead of the literal `"not_verified"`;
  `expected_session_count` is `number | null`. `MarketDataStatus` is untouched.
- `frontend/src/components/historyData.ts`: `historyCandles` validates the 5-value union and
  requires `expected_session_count` to be `null` exactly when `coverage_status` is
  `"not_verified"`, a non-negative safe integer otherwise. `indicatorOverlay`'s equality check
  against the nested history was already value-agnostic and needed no change.
- `tests/test_exchange_calendar.py` (new): 11 focused tests, each independently-confirmed
  reference date cited above.
- `tests/test_market_history.py`: 3 existing assertions that hardcoded `"not_verified"`/`null`
  for the per-symbol endpoint were updated to assert the real computed value (derived from the
  shared calendar module using that test's own window, not re-hardcoded); 4 new tests cover
  `"complete"`, `"unexpected_sessions"`, `"gaps_and_unexpected_sessions"`, and the
  `"not_verified"` range-fallback explicitly. `"gaps"` is covered by the two updated existing
  tests. The `_assert_reconciled` helper (used only by `/market/data-status` tests) and its
  `"not_verified"` assertion were left unchanged.
- `tests/test_market_indicators.py`: 1 existing assertion (`test_warmup_empty_unknown_and_excluded_do_not_leak`)
  now compares the indicator response's coverage fields against a live `/market/symbols/BARE/history`
  call for the same symbol, instead of hardcoding a literal, so it can't silently drift from the
  calendar logic living in one place. Two other literal dicts (`"not_verified"`, around what are
  now lines ~341 and ~411) are monkeypatched `fake_history` stub fixtures that bypass
  `_symbol_history` entirely and were correctly left untouched — they don't exercise the
  calendar.
- `docs/P1C_DATA_CONTRACT.md`, `docs/P3A_INDICATOR_CONTRACT.md`: updated to describe the new
  per-symbol values; `data-status` sections explicitly left stating the unchanged behavior.

## Verification run, 2026-11-07

Local environment: Python 3.14.6, `AUDIT_DATABASE_URL` unset (SQLite). Node/npm per
`frontend/package.json`.

- `python -m pytest -q tests/test_exchange_calendar.py tests/test_market_history.py tests/test_market_indicators.py`:
  **55 passed**, 0 failed (11 calendar + 44 history/indicator).
- Full local backend suite, `python -m pytest -q`: **295 passed, 28 skipped**, 2 pre-existing
  unrelated errors (`test_sqlite_file_create_at_19_blocks_until_commit`,
  `test_sqlite_file_busy_timeout_is_retryable_503` in `tests/test_watchlists.py` — confirmed via
  `git stash` to error identically on the unmodified checkout; this is a Windows local
  SQLite-file-locking environment issue, not something this change introduced, and the CI
  `backend` job runs on Linux against PostgreSQL where this path is not exercised the same way).
- Frontend: `npm run lint` clean, `npx tsc -b --noEmit` clean, `npm run test` (Vitest):
  **300 passed (300), 26 test files passed (26)** — unchanged from before this unit, since the
  new validator is a strict superset of the old behavior (the old `"not_verified"`/`null`
  default case is still accepted). `npm run build`: succeeds, same pre-existing ~566 kB main
  bundle size warning as before.

This does not close full P3-A (other indicators, chart modes, timeframes, volume, preferences)
or P1-C (provider ingestion remains gated by a written provider decision; `data-status`'s
coverage fields remain a deferred, separate unit). No migration, grant, provider, or hosted
change is part of this unit. No merge or deploy is claimed.
