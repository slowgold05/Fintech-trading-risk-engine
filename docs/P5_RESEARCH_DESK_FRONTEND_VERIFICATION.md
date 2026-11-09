# Research Desk frontend verification

First frontend surface for any of Phase 5's six backend routes (PRs #69-#74): a new
`/research` page letting a signed-in user create a research job, watch its status,
cancel a still-queued one, view a completed report, and browse personalized daily
briefs. No new backend endpoints — purely wiring against what already ships.

Design/UX skills consulted before implementation: `frontend-design`, `ui-ux-pro-max`,
`web-design-guidelines`, `vercel-composition-patterns`, `vercel-react-best-practices`,
`bencium-controlled-ux-designer`. Because this extends an already-established dark
terminal design system (not a new product), their accessibility/composition/
performance guidance was applied directly rather than their greenfield style-selection
tooling — no new color, typography, or layout decision was made; every visual choice
mirrors an existing pattern already shipped on `/portfolio` (`DashboardCard`,
`.field-control`, `.primary-action`, `EmptyState`, `SkeletonBlock`, the
`TradeImpactPreview`/`CustomRiskScenarios` mutation-card shape).

**Deliberately no auto-polling.** The scheduler's own research-job step runs on the
same cadence as every other scheduled step (`scheduled_job_interval_hours`, default
24h) — auto-refetching a job's status every few seconds would imply near-real-time
processing the backend does not actually provide. A manual "Refresh" control is used
instead, consistent with this project's own prior truthfulness correction
(`UI_DATA_TRUTHFULNESS.md`, P2): never imply immediacy the backend doesn't deliver.

## Implemented by Grok, independently verified by me

- `frontend/src/api/research.ts` (new): five functions, one `apiClient` call each.
- `frontend/src/types/schemas.ts`: four new interfaces, additive only.
- `frontend/src/pages/Research.tsx` (new): four self-contained section components
  (create-job form, jobs list, report viewer, briefs list) composed in one page.
- `frontend/src/App.tsx` / `frontend/src/components/AppShell.tsx`: one new route, one
  new nav item; no existing route or nav item touched.
- `frontend/src/pages/Research.test.tsx` (new).

## Independent verification

- Reviewed the full diff of every touched/new file directly (not Grok's self-report).
- Confirmed every existing route/nav item/page/test file is byte-identical to before
  this change.
- Confirmed the job-report correlation is done client-side by matching `job_id`
  (jobs and reports are deliberately decoupled resources on the backend, by PR #70/#71
  design) — not by inventing a new backend field.
- Confirmed the "View report" path handles the not-yet-generated case (a completed
  job whose report hasn't appeared in a stale reports list yet) with an honest
  message and a refresh action, not a silent failure or a fabricated placeholder.
- Confirmed cancel is only offered for `status === "queued"` jobs, matching the
  backend's own `409` rule, and that a `409` response (job no longer queued, e.g. a
  race with the scheduler) surfaces as the existing inline error style, not a crash.
- Confirmed every null report field (`bull_case`/`bear_case`/`synthesis`/`risks`/
  `model_version`/`prompt_version`/`backend_detail`) renders the same "Unavailable"
  treatment `TradeImpactPreview`'s own incomplete-case fields already use — not blank,
  not a crash, not a fabricated value.
- `npm run test -- src/pages/Research.test.tsx`: **9 passed** (all new).
- `npm run test` (full frontend suite): **408 passed** (29 test files) — up from 399
  before this unit, every pre-existing test file unchanged.
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeds with no type
  errors (one pre-existing chunk-size warning, unrelated to this change).
- Confirmed no file under `app/`, `tests/`, or `alembic/` was touched (`git status`
  grep for backend paths returns no matches).
- No manual browser/visual check performed — verified via the automated component
  test and production build only, the same disclosed boundary every prior frontend
  wiring unit this session has used.

## What this unit does not do

Does not add auto-refresh/polling (disclosed above). Does not add a symbol
autocomplete or client-side validation beyond "non-empty" (the backend's own `400`/
`409`/`422` surface through the existing inline error style). Does not expose
TradingAgents' `backend_detail` sub-fields with dedicated UI beyond a plain read-only
rendering — no new visual treatment invented for that data. Does not change any
existing page, card, or route.
