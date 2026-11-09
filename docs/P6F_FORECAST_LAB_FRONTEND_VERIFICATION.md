# Forecast Lab frontend verification

Sixth and final currently-scoped unit of roadmap Phase 6 — the chart UI (section
6.2), closing out Phase 6's own checklist. A new `/forecasts` page: queue a
forecast job, watch its status, cancel a still-queued one, view a completed
forecast as a chart separating observed history from the generated path, see the
configured model's status, and see whether it has ever been evaluated (honestly:
not yet, PR #80's own disclosed state). No new backend routes — pure frontend
wiring against PRs #76-#80.

## Implemented by Grok, independently verified by me

- `frontend/src/api/forecasts.ts` (new): six functions, one `apiClient` call
  each.
- `frontend/src/types/schemas.ts`: five new interfaces, additive only.
- `frontend/src/components/ForecastChart.tsx` (new): the chart component, its
  own independent lightweight-charts lifecycle — does not touch or extend
  `DailyHistoryCanvas`.
- `frontend/src/pages/ForecastLab.tsx` (new): five section components composed
  in one page.
- `frontend/src/App.tsx` / `frontend/src/components/AppShell.tsx`: one new
  route, one new nav item; no existing route or nav item touched.
- `frontend/src/pages/ForecastLab.test.tsx` (new).

## Independent verification

- Reviewed the full diff of every touched/new file directly (not Grok's
  self-report).
- Confirmed every existing route/nav item/page/test file, and
  `DailyHistoryCanvas` itself, are byte-identical to before this change.
- Confirmed no auto-polling was added (manual "Refresh" buttons only), same
  reasoning PR #75 already established.
- Confirmed the job-result correlation is done client-side by matching
  `job_id` (the two resources are deliberately decoupled on the backend, same
  pattern PR #75 used for research jobs/reports) — not a new backend field.
- Confirmed the chart renders observed bars as candlesticks and the forecast as
  a visually distinct dashed line series (not a second candlestick series),
  and that the caption states the cutoff date, `generated_at`, `model_name`,
  and the fixed "not a prediction" sentence — matching the contract's own
  explicit, disclosed choice not to draw a vertical cutoff line.
- Confirmed the empty-evaluations state renders as a plain informational
  message, not styled as an error.
- `npm run test -- src/pages/ForecastLab.test.tsx`: **9 passed** (all new).
- `npm run test` (full frontend suite): **417 passed** (30 test files) — up
  from 408 before this unit, every pre-existing test file unchanged, including
  `DailyHistory.test.tsx` (26 passed, confirmed byte-identical behavior).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeds with no
  type errors (same pre-existing chunk-size warning, unrelated to this change).
- Confirmed `DailyHistory.tsx` is byte-identical (`git diff --stat` empty) and
  no file under `app/`, `tests/`, or `alembic/` was touched.
- **Noted, not a defect**: `ForecastLab.test.tsx` does not mock
  `lightweight-charts` (unlike `DailyHistory`'s own tests, which — per this
  component's established lifecycle-testing design — keep the dynamic import
  deliberately pending to avoid ever letting the real chart library run in
  JSDOM). As a result, the real library's `createChart()` runs against JSDOM's
  canvas and logs seven expected `"Not implemented: HTMLCanvasElement's
  getContext()"` console warnings — harmless noise from a well-understood JSDOM
  limitation, caught safely by `ForecastChart.tsx`'s own `try`/`catch`, which is
  exactly why all 9 tests still pass (they assert on data-fetching and caption
  text, not literal pixel rendering) — consistent with the disclosed "no manual
  browser/visual check" boundary below.
- No manual browser/visual check performed — verified via the automated
  component test and production build only, the same disclosed boundary every
  prior frontend wiring unit this session has used.

## What this unit does not do

No new backend route. No drawn vertical cutoff line (a text caption instead,
disclosed as deliberate given the charting library's own constraints). No
sampled-path/range visualization (none exists to show, PR #76's own design).
Does not touch `DailyHistoryCanvas`, `/portfolio`, `/research`, or any other
existing page/route.
