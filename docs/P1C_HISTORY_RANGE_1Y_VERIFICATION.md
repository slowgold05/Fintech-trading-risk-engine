# 1-year history range verification

This unit adds `range=1y` alongside the existing `range=2y` on
`GET /market/symbols/{symbol}/history` and (via the same `range_token` plumbing)
`GET /market/symbols/{symbol}/indicators`. Backend-only. No router, frontend, migration, or
provider change — a frontend range selector is a separate, later unit. Contract:
[P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md).

## What this unit also quietly fixed

Before this unit, `range_token` was validated (must equal `"2y"`) but never actually used:
`_symbol_history` always called the hardcoded `two_calendar_years_before(end)`, and the response
always reported the literal `"range": "2y"` regardless of what was validated. Since only one
value was ever accepted, this was invisible — but it meant the `range` field wasn't really
"the value that was requested and served," it was a hardcoded constant that happened to match
the only legal input. Adding a second value forced both to become genuinely request-driven; the
contract doc now says so explicitly rather than leaving that narrow pre-existing inaccuracy
undocumented.

## Implemented by Grok, independently verified by me

Scoped to exactly 4 files via per-file `--allow` rules. Grok's implementation:
- New `one_calendar_year_before(day)`, mirroring the existing `two_calendar_years_before`'s
  leap-day fallback convention exactly (29 February falls back to 28 February), not a
  differently-invented rule.
- `_symbol_history` gained a `range_token` parameter and dispatches the window start on it;
  `read_symbol_history` now actually passes `range_token` through (previously it validated the
  value and dropped it).
- The response's `"range"` field now echoes `range_token` instead of a hardcoded literal.
- Correctly noticed that `"range": "1y"` was previously in `test_market_history.py`'s
  invalid-range-rejection parametrize list (since `"1y"` used to be rejected) and moved it out,
  replacing it with still-genuinely-invalid tokens (`"6mo"`, `"3y"`) plus two more
  (case-variant `"1Y"`, empty string) — recognizing that leaving `"1y"` in that list would have
  made the test assert a now-false rejection.
- Added a boundary test that proves the window actually shrank, not just that the `range` field
  echoes back correctly: seeds a bar one day outside the 1-year window but inside the 2-year
  window, and asserts it's excluded from a `range=1y` response but included in a `range=2y`
  response against the same data.

Independent verification I did myself:
- `git status` confirmed only the 4 scoped files changed.
- Read the full `market_history.py` diff; confirmed `_coverage`'s docstring comment was also
  updated to describe both possible windows, a detail not explicitly requested but correct and
  consistent.
- Re-ran `python -m pytest -q tests/test_market_history.py tests/test_market_indicators.py`:
  **69 passed**, 0 failed.
- Re-ran the full backend suite: **320 passed, 28 skipped**, same 2 pre-existing unrelated
  Windows-local SQLite-locking errors documented since PR #27.
- Confirmed the one existing `test_market_indicators.py` assertion that hardcoded the old
  `"range must be 2y."` error text was updated to `"range must be 1y or 2y."`, and grepped for
  any other stale occurrence of that exact string — none remained.
- Read the contract doc diff against the actual code; every claim matches.

## What changed

- `app/services/market_history.py`: new `one_calendar_year_before`; `SUPPORTED_RANGES` gained
  `"1y"`; `_validate_history_query`'s error text updated; `read_symbol_history` passes
  `range_token` through; `_symbol_history` dispatches the window start on it and echoes the
  requested value in the response.
- `tests/test_market_history.py`: updated the invalid-range parametrize list (moved `"1y"` out,
  added `"6mo"`/`"3y"`/`"1Y"`/`""`); 2 new tests (rejection at both the route and service level
  for the updated error text; the 1-year-vs-2-year window boundary proof).
- `tests/test_market_indicators.py`: 1 stale error-text literal updated.
- `docs/P1C_DATA_CONTRACT.md`: the `range` query-rule row and window-description prose updated
  for both supported values.

## Correction found during CI browser verification

The first head's CI `browser` job failed `test_p3a_history.py::test_cached_daily_chart` three
times in a row with the same `TimeoutException` waiting for the chart canvas. I initially
misdiagnosed this as an environment flake (this stack had genuinely hit unrelated flakes
earlier) and reran twice before stopping to actually investigate the identical repeated failure.
The real cause: `tests/browser/isolated_api.py`'s `P3A_BAD_HISTORY_FIXTURE` monkeypatch wrapper
(used only by this one test file, to inject a corrupt close price for one symbol) called
`market_history._symbol_history` directly with the pre-this-unit keyword set
(`symbol`/`interval`/`provider`/`adjustment_type`, no `range_token`). Once `_symbol_history`
gained a required `range_token` keyword, every call through that wrapper raised `TypeError:
missing 1 required keyword-only argument: 'range_token'`, 500ing the endpoint for every symbol in
that test (not just the one the fixture is meant to corrupt) — which is why the frontend never
got a chart to render and the Selenium wait timed out, deterministically, every time. Fixed by
adding `range_token` to the wrapper's signature and forwarding it to the real function. Verified
locally via a standalone script importing the patched module and confirming the call now
proceeds past the previous `TypeError` point (an unrelated, expected failure further in from an
intentionally minimal ad hoc DB setup) instead of failing there. This is scoping-review gap on my
part — I should have grepped for every caller of a function before changing its signature, not
just the router/service callers; `isolated_api.py`'s direct monkeypatch of a private function
was outside what Grok's scoped task touched (it was never in its file list) and outside what my
own pre-launch grep for `_symbol_history(` callers caught at the time, because I only grepped
right before this doc section, not before writing the task.

## Verification run, 2026-11-07

- `python -m pytest -q tests/test_market_history.py tests/test_market_indicators.py`:
  **69 passed**, 0 failed.
- `python -m pytest -q` (full backend suite), local Python 3.14.6, `AUDIT_DATABASE_URL` unset
  (SQLite): **320 passed, 28 skipped**, 2 pre-existing unrelated errors (documented above).
- No file outside the four listed above was touched.

This does not add a frontend range selector (the frontend still only ever requests `"2y"`,
unaffected and unchanged), and does not close P3-A or any other phase. No merge or deploy is
claimed.
