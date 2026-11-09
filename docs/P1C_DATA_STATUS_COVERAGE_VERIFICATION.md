# Per-series data-status coverage verification

This unit adds real `coverage_status`/`expected_session_count` to each entry in
`GET /market/data-status`'s `canonical_history.series[]`, compared against that series' own
stored span — the design this project deliberately deferred when the per-symbol exchange
calendar landed (see [P1C_EXCHANGE_CALENDAR_VERIFICATION.md](P1C_EXCHANGE_CALENDAR_VERIFICATION.md)),
because `data-status` aggregates across the whole universe with no single window. The user chose
the per-series breakdown over leaving it alone, when asked directly about the design fork (see
[V2_BACKLOG.md](V2_BACKLOG.md)). Backend-only. No migration, grant, provider, or frontend change.
Contract: [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md) (updated sections: top-level response,
Canonical series, Reviewed exchange calendar).

## Implemented by Grok, independently verified by me

Scoped to exactly 3 files via per-file `--allow` rules (same pattern as the two prior Grok
units). The task specified the exact shared refactor to avoid duplicating the four-way
complete/gaps/unexpected_sessions/gaps_and_unexpected_sessions branch that already existed in
the per-symbol `_coverage` helper, and the exact scope decision for which rows count as "stored"
(any `quality_status`, matching the existing `stored_session_start`/`stored_session_end` scope,
not just `"valid"` rows).

Grok's implementation:
- Extracted `_coverage_status_from_dates(expected, actual) -> str` out of the existing
  `_coverage` function (pure refactor — `_coverage`'s own behavior, docstring, and every
  existing per-symbol-history coverage test are unchanged).
- Added `_series_coverage(start, end, stored_dates)` for the per-series case (`None` start/end
  falls back to `"not_verified"`/`None`, same as an out-of-calendar-range window).
- Added one more query for distinct `(provider, adjustment_type, session_date)` triples, grouped
  the same way the existing span query already is.
- Factored the three places that built the same default series dict literal into one
  `_empty_canonical_series(provider, adjustment_type)` helper — a DRY improvement beyond what the
  task asked for, not a weaker refactor.
- Left the top-level `coverage_status`/`expected_session_count` untouched, exactly as specified.

Independent verification I did myself:
- `git status` confirmed only the 3 scoped files changed.
- Read every changed line in `market_history.py` against the spec, including the
  `date.fromisoformat(_date_text(session_date))` round-trip used to get a real `date` object from
  whatever the ORM returns for `session_date` — reuses the existing `_date_text`/`_as_date`
  conversion path rather than assuming the driver always returns a `datetime.date`, consistent
  with the file's existing caution level.
- Re-ran `python -m pytest -q tests/test_market_history.py`: **23 passed** (18 existing + 5 new).
- Re-ran the full backend suite: **318 passed, 28 skipped**, the same 2 pre-existing unrelated
  Windows-local SQLite-locking errors documented since
  [P1C_EXCHANGE_CALENDAR_VERIFICATION.md](P1C_EXCHANGE_CALENDAR_VERIFICATION.md).
- Checked the 5 new tests actually prove what they claim: `test_data_status_series_coverage_complete`
  deliberately seeds one bar with `quality="flagged"` to prove coverage counts every stored
  session regardless of quality status, not just `"valid"` ones; `test_..._unexpected_sessions`
  deliberately seeds a `quality="rejected"` Saturday bar for the same reason;
  `test_..._stays_independent_across_series` seeds two different `(provider, adjustment_type)`
  pairs with different outcomes (`"complete"` vs `"gaps"`) and confirms neither overwrites the
  other; every new test also asserts the top-level fields stay `"not_verified"`/`null`.
- Confirmed via `grep` that no existing test asserts the exact key set of a `canonical_history`
  series entry via dict equality (which the two new keys would have broken) — all existing
  assertions read individual fields, unaffected by added keys.
- Read the `P1C_DATA_CONTRACT.md` diff against the actual code; every claim in it matches.

## What changed

- `app/services/market_history.py`: new `_coverage_status_from_dates`, `_series_coverage`,
  `_empty_canonical_series`; `_data_status` runs one additional distinct-session-date query;
  `_canonical_history` takes a third parameter and sets `coverage_status`/`expected_session_count`
  on every series entry. `_coverage` (per-symbol) is behavior-unchanged, refactored to call the
  new shared helper.
- `tests/test_market_history.py`: 5 new tests (complete, gaps, unexpected_sessions,
  gaps_and_unexpected_sessions, and cross-series independence), all against a real, independently
  checked NYSE trading week (`exchange_calendar.expected_session_dates` is asserted directly in
  the test fixture, not just trusted).
- `docs/P1C_DATA_CONTRACT.md`: top-level response description, "Canonical series", and "Reviewed
  exchange calendar" sections updated to describe the new per-series fields and reaffirm the
  top-level fields' unconditional `"not_verified"`/`null` is deliberate.

## Verification run, 2026-11-07

- `python -m pytest -q tests/test_market_history.py`: **23 passed**, 0 failed.
- `python -m pytest -q` (full backend suite), local Python 3.14.6, `AUDIT_DATABASE_URL` unset
  (SQLite): **318 passed, 28 skipped**, 2 pre-existing unrelated errors (documented above).
- No file outside `app/services/market_history.py`, `tests/test_market_history.py`, and
  `docs/P1C_DATA_CONTRACT.md` was touched.

The frontend `CanonicalHistorySeries` type is not widened in this unit (it is documented as a
separate, small follow-up — nothing in the frontend currently reads these two new fields, so
this is not a breaking gap, just an incomplete type). No merge or deploy is claimed.
