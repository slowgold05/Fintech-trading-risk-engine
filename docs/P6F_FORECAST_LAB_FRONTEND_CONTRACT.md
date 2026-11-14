# Forecast Lab frontend contract

Sixth and final currently-scoped unit of roadmap Phase 6 — the chart UI (section
6.2), the one piece of Phase 6's own checklist not yet built. A new `/forecasts`
page mirroring `/research`'s own shape (PRs #69-#75): queue a forecast job, watch
its status, cancel a still-queued one, view a completed forecast as a chart that
visibly separates observed history from the generated path, see the one
configured model's status, and see whether it has ever actually been evaluated.

## Roadmap 6.2's own checklist, and how this unit satisfies (or honestly doesn't
satisfy) each item

- *"Separate observed bars from generated paths with a visible cutoff marker."*
  Observed bars render as the existing candlestick style (PR history: same colors
  `DailyHistory.tsx` already uses). The generated path renders as a **dashed
  line** tracking only the forecasted close (not a second candlestick series —
  a forecast is not real OHLC data, and rendering it as candles would visually
  imply a precision it doesn't have). lightweight-charts v5 has no built-in
  arbitrary vertical-line primitive, so the "cutoff marker" is a **text caption**
  stating the exact cutoff date, not a drawn vertical line — disclosed here as a
  deliberate, explained choice, not an oversight.
- *"Provide a forecast toggle, supported horizon selector, generation date, and
  model information."* The create-job form **is** the horizon selector (the
  existing `POST /forecasts/jobs` field, PR #77); the result view's caption shows
  `generated_at`, `model_name`, `tokenizer_name`.
- *"Show sampled paths or empirical scenario ranges if produced by the selected
  implementation."* Not applicable — PR #76's own design returns one averaged
  path per call (`sample_count` averages internally; Kronos does not return
  separate scenario paths through this integration). The caption says this
  explicitly, so nobody expects a range that was never produced.
- *"Do not label sampled-path dispersion as a calibrated confidence interval
  without coverage evaluation."* There is no dispersion to mislabel (see above).
  The `ForecastEvaluationsCard` additionally shows, honestly, that **no
  evaluation has ever been recorded** (PR #80's own disclosed state) — satisfying
  this item's actual spirit by being upfront about validation status at all,
  not just by avoiding one specific mislabeling.
- *"Include input freshness, supported universe, and a clear experimental
  label."* The page gets a persistent "Experimental" badge in its header. Input
  freshness is the observed series' own `available_end`/`read_at` (already
  returned by `fetchDailyHistory`, PR #65's own existing API). "Supported
  universe" is simply "a symbol known to this app's own market-symbol list" —
  the same validation the create-job form already enforces server-side (PR #77).
- *"Keep historical charts and trading usable when inference is disabled or
  unavailable."* This unit touches no existing page/route — `/portfolio`'s own
  `DailyHistory` chart, `/trades`, order placement, are all untouched.
- *"Prevent forecast output from triggering orders, overriding deterministic
  limits, or changing execution prices."* Trivially true — this unit reads two
  existing GET-only data sources and renders them; nothing it does writes to any
  order, limit, or price path.

## No new backend routes. Pure frontend wiring against what already ships
(PRs #76-#80).

## New API client: `frontend/src/api/forecasts.ts`

Mirrors `frontend/src/api/research.ts`'s exact minimal-wrapper style:
`createForecastJob`, `listForecastJobs`, `cancelForecastJob`,
`listForecastResults`, `listForecastModels`, `listForecastEvaluations` — one
`apiClient` call each, typed request/response.

## New types in `frontend/src/types/schemas.ts`

`ForecastJob`, `ForecastBar`, `ForecastResult`, `ForecastModel`,
`ForecastEvaluation` — additive only, matching the backend's own `*Out`/
`*Collection` shapes exactly (PRs #77-#80).

## New page: `frontend/src/pages/ForecastLab.tsx`, route `/forecasts`, nav item
"Forecast Lab"

`PageHeader` with an "Experimental" `badge` prop (the existing `PageHeader`
component already supports one, used elsewhere in this app) and a description
stating this previews model-generated price paths, not predictions, and places
no trades. Five self-contained section components, same shape as every prior
`DashboardCard`-based form/list card this session has built:

- **`CreateForecastJobCard`** — mirrors `CreateResearchJobCard`'s exact shape,
  extended with the four extra fields (`provider`, `adjustment_type`, `lookback`,
  `horizon`, `sample_count`) PR #77's own schema requires. Client-side validation
  only that every field is non-empty — the backend's own `400`/`409`/`422`
  surfaces through the existing inline error style, same as every prior unit.
- **`ForecastJobsCard`** — mirrors `ResearchJobsCard` exactly: manual "Refresh"
  button (no auto-polling — the scheduler's own `scheduled_forecast_job_limit`
  defaults to `1` per cycle on a long interval, PR #78; implying near-real-time
  processing would be dishonest, same reasoning PR #75's own Research Desk
  frontend already established), status badges, "Cancel" for `queued` rows,
  "View forecast" for `completed` rows.
- **`ForecastChartCard`** — shown when a job is selected. Fetches the matching
  `ForecastResult` (by `job_id`, from the shared `GET /forecasts` list — same
  decoupled-resource-correlation pattern PR #75 already used for research
  reports) and, once found, the observed history via the **existing**
  `fetchDailyHistory(symbol, provider, adjustment_type, "2y")` (reused as-is, no
  new backend call). Renders a lightweight-charts chart (dynamically imported,
  its own independent lifecycle `useEffect` — does **not** touch or extend
  `DailyHistoryCanvas`, to avoid any risk to that already-tested component):
  candlestick series for the observed bars up to `input_cutoff`, a dashed line
  series (a color not already used for a primary series elsewhere on this page,
  e.g. amber `#fbbf24`) for the forecast's own `bars` (closes only). A caption
  states the cutoff date, `generated_at`, `model_name`, `tokenizer_name`, and the
  fixed sentence: *"This is one model-generated path, not a prediction and not a
  guaranteed future price."*
- **`ForecastModelsCard`** — small, read-only, `GET /forecasts/models` (PR #79):
  the one configured model's `enabled` status and bounds, so a user who can't
  get a forecast understands why (disabled by default server-side).
- **`ForecastEvaluationsCard`** — small, read-only, `GET /forecasts/evaluations`
  (PR #80): when empty (the honest default today), states plainly *"No
  evaluations recorded yet. This model's forecasting accuracy has not been
  validated."* — not styled as an error, a legitimate disclosed state.

## What this unit does not do

No new backend route. No drawn vertical cutoff line (a text caption instead,
disclosed above as a deliberate choice given the charting library's own
constraints). No sampled-path/range visualization (none exists to show). No
manual browser/visual check of the actual rendered chart — verified via the
automated component test and production build only, the same disclosed boundary
every prior frontend wiring unit this session has used. Does not touch
`DailyHistoryCanvas`, `/portfolio`, `/research`, or any other existing page/route.
