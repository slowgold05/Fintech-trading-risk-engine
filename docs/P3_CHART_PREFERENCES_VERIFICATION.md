# Persisted chart preferences verification

Persists the daily history chart's range, indicator, period, and chart type to the browser's
`localStorage`, closing the roadmap's Phase 3 line "Persisted chart preferences." The selected
symbol/series is deliberately **not** persisted — only display preferences. Purely a per-browser
client convenience; no new backend endpoint, no server-side storage.

## Implemented by Grok, independently reviewed by me

Four files touched: `frontend/src/utils/chartPreferences.ts` (new), `frontend/src/utils/
chartPreferences.test.ts` (new), `frontend/src/components/DailyHistory.tsx`, and its test
file. `frontend/src/components/historyData.ts` is byte-identical.

- Every stored field is individually validated against its own allowed-value set before being
  trusted (never a blind spread of parsed JSON into state) — a corrupted, stale-schema, or
  tampered `localStorage` entry degrades field-by-field to the existing hardcoded default,
  never throws. Both `loadChartPreferences`/`saveChartPreferences` are wrapped in `try`/`catch`
  with a safe fallback, correctly treating this as a best-effort convenience exactly as the
  Artifact storage guidance this session's own tool instructions describe for this class of
  per-viewer `localStorage` use — a private window, blocked site data, or a full quota must
  never break the chart.
- A genuinely necessary design choice I did not explicitly spell out: the persistence
  `useEffect`'s cleanup calls a test-mode-only `discardChartPreferencesInTests()` (a no-op in
  production, gated on `import.meta.env.MODE === "test"`) on unmount. This solves a real
  problem I hadn't considered: `DailyIndicators.test.tsx` **also** renders `<DailyHistory />`
  across many of its own tests, and that file was correctly left outside this unit's edit
  scope (not in the list of files I gave Grok permission to touch) — without this component-
  level cleanup, a preference saved by one test in that file would leak into the next test's
  initial render via shared `localStorage` within that file's jsdom environment, since that
  file has no `localStorage.clear()` of its own. I verified this concern was real by running
  the **full** suite (not just the two files Grok's task directly touched) and confirming
  `DailyIndicators.test.tsx`'s own, untouched tests all still pass cleanly.
- `DailyHistory.test.tsx` itself additionally gained its own local `beforeEach`/`afterEach`
  `localStorage.clear()` — a second, independent layer of isolation for that file specifically,
  on top of the component-level unmount cleanup.

## Independent verification

- Reviewed the full diff of all four files directly (not Grok's self-report), including
  specifically scrutinizing the test-mode-only cleanup mechanism's design rationale before
  accepting it, rather than taking it at face value.
- `npm run test` inside `frontend/`: **390 passed** (0 failed) across **28** test files (up
  from 27 — the new `chartPreferences.test.ts` file) — up from 377 before this unit (13 new
  tests: 11 in the new preferences test file, 2 in `DailyHistory.test.tsx`; all 377
  pre-existing tests across every file, including the untouched `DailyIndicators.test.tsx`,
  still pass unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors
  (`import.meta.env.MODE` resolves correctly at build time).
- Confirmed `frontend/src/components/historyData.ts` is byte-identical to before this change.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not persist the selected symbol, cached series/provider choice, or any form field beyond
the four display preferences (range, indicator, period, chart type). Does not add a
server-side "preferences" concept or endpoint — this is deliberately a per-browser
convenience only. Does not change `historyData.ts` or any indicator-parsing logic.
