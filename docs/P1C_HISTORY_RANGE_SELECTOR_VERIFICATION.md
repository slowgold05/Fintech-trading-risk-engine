# History range selector verification

This unit adds a Range selector (1 year / 2 years) to the daily chart form, exposing the
`range=1y` backend support landed in [PR 33](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/33)
(see [P1C_HISTORY_RANGE_1Y_VERIFICATION.md](P1C_HISTORY_RANGE_1Y_VERIFICATION.md)). Frontend-only.
No backend, migration, or provider change.

## Implemented by Grok, interrupted by a host memory-pressure kill, finished by me

Scoped to 7 files via per-file `--allow` rules. Partway through, the harness killed Grok's
background process because the host was critically low on memory — not a failure of the task or
anything Grok did. Reviewing the actual diff showed the core work (all 7 files) was substantively
complete and correct — it was very likely killed during its own final verification pass, not
mid-edit. I did not restart it (per the harness's own guidance not to restart a memory-pressure
kill automatically); instead I reviewed what landed and finished the remaining gap myself.

That gap was my own scoping mistake, not Grok's: I listed `historyData.test.ts`,
`DailyHistory.test.tsx`, and `DailyIndicators.test.tsx` as the frontend tests in scope, but missed
that `frontend/src/api/history.test.ts` and `frontend/src/api/indicators.test.ts` call
`fetchDailyHistory`/`fetchDailyIndicators` directly (testing the API client functions
themselves), and that `frontend/src/pages/Home.test.tsx` renders `DailyHistory` and asserts a
strict `toHaveBeenCalledWith` call shape on the mocked fetch function. Both signature changes
(adding a `range` parameter) needed those three files updated too. I found all three myself via
`npx tsc -b --noEmit` (caught the two API test files as compile errors) and a full `npm run test`
run (caught `Home.test.tsx` as a runtime timeout, since a mismatched `toHaveBeenCalledWith` just
never resolves rather than failing immediately) — then grepped every remaining consumer of both
functions across the frontend (`App.test.tsx`, `DailyHistoryLifecycle.test.tsx`) to confirm no
further gaps, before fixing the three real ones with the minimal correct change (inserting the
new positional argument at existing call sites, no assertions weakened).

## What Grok built

- `frontend/src/api/history.ts`: new `HistoryRange = "1y" | "2y"` type; `HistoryResponse.range`
  widened from the literal `"2y"`; `fetchDailyHistory` takes a 4th `range` parameter, removing
  the hardcoded `DAILY_RANGE` constant.
- `frontend/src/api/indicators.ts`: same treatment for `fetchDailyIndicators` (`range` inserted
  as the 4th parameter, before `name`/`period`).
- `frontend/src/components/historyData.ts`: the envelope's range check now accepts either value.
- `frontend/src/components/DailyHistory.tsx`: a new Range `<select>` (1 year / 2 years,
  defaulting to `2y` — today's existing behavior is unchanged by default); threaded through
  `SubmittedSeries`, the query key, `formDiffers`, and both fetch call sites; a new
  `readHistoryRange` validator mirroring the existing `readIndicatorChoice` pattern.
- `frontend/src/components/historyData.test.ts`, `DailyHistory.test.tsx`,
  `DailyIndicators.test.tsx`: new tests for the `1y` path, plus every existing call-shape
  assertion correctly updated for the new argument (including moving `{range: "1y"}` out of an
  invalid-envelope parametrize list, since it's now valid, replacing it with a still-genuinely-
  invalid `{range: "6mo"}` — the same correction pattern seen in the backend unit).

## What I added after reviewing the interrupted run

- Fixed `frontend/src/api/history.test.ts` and `frontend/src/api/indicators.test.ts` (2 call
  sites each) — outside Grok's scoped file list, caught by `tsc`.
- Fixed `frontend/src/pages/Home.test.tsx` (1 call site) — outside Grok's scoped file list,
  caught by a runtime test timeout, not a compile error.
- Added a browser-test check to `tests/browser/test_p3a_history.py::test_cached_daily_chart`:
  selects `1y`, confirms the rendered "Requested" window genuinely shrinks (computed
  independently via the real `one_calendar_year_before`/`two_calendar_years_before` backend
  helpers against the test's own captured clock, not a hardcoded date), then switches back to
  `2y` so the rest of the existing test's assumptions are undisturbed.

## Verification run, 2026-11-07

- `npx tsc -b --noEmit`: clean.
- `npm run lint`: clean.
- `npm run test`: **336 passed (336)**, 27 files, up from 333.
- `npm run build`: succeeds, same pre-existing bundle-size warning.
- Browser (`tests/browser/test_p3a_history.py`): not run locally (Selenium blocked on Windows in
  this environment); relies on CI's `browser` job, same as every prior chart unit in this stack.

This does not add a selector for any interval other than `1d`, does not close P3-A, and does not
change the backend. No merge or deploy is claimed.
