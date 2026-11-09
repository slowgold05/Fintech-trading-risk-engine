# History timeframes frontend wiring verification

Wires the four new backend-only history timeframes (PR #63: `1m`/`3m`/`6m`/`all`, alongside the
existing `1y`/`2y`) into the daily history chart's range `<select>`, closing the full frontend
scope of the roadmap's Phase 3 line "Historical timeframes: 1M, 3M, 6M, 1Y, 2Y, and All."

## Implemented by Grok, independently reviewed by me

Four files touched: `frontend/src/api/history.ts` (the `HistoryRange` type widened from two to
six literals), `frontend/src/components/DailyHistory.tsx` (four new `<option>`s and
`readHistoryRange` extended to recognize all six — the existing `"2y"` fallback and default
`rangeDraft` are both unchanged), and two test files (extended, no existing test changed).
`frontend/src/components/historyData.ts` is byte-identical — this is pure option-list wiring,
no change to data parsing.

- The default range the form starts with is still `"2y"` — confirmed directly: the new
  parametrized test explicitly asserts `toHaveValue("2y")` before selecting any new option.
- `DailyHistory.test.tsx`'s new test covers all four new tokens in one parametrized case
  (`it.each`), each asserting the exact request string reaches `fetchDailyHistory` unchanged.
- `DailyIndicators.test.tsx` got a dedicated test confirming a new range token (`"6m"`) still
  flows correctly through to `fetchDailyIndicators` alongside an active indicator selection —
  proving the new tokens work on the indicator code path, not just the plain-history one.

## Independent verification

- Reviewed the full diff of all four files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **377 passed** (0 failed) — up from 372 before this unit (5
  new tests; all 372 pre-existing tests, including every other component's tests, still pass
  unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- Confirmed `frontend/src/components/historyData.ts` is byte-identical to before this change.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not add any new chart feature beyond the range options themselves (no new UI for
inspecting what each new window actually returns, beyond what the existing history-facts
display already shows for any range). This closes the full timeframe scope — backend (PR #63)
and frontend (this unit) — of the roadmap's "Historical timeframes" line.
