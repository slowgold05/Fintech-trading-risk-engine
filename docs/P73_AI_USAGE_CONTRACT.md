# Phase 7.3 — AI usage instrumentation (closes the last open roadmap-7.3 item)

Roadmap 7.3's last bullet: "operational monitoring for data freshness, job
age, retries, and AI cost." Data freshness and job age/failure counts
already shipped in `GET /compliance/ops-health`
([P73_OPS_HEALTH_CONTRACT.md](P73_OPS_HEALTH_CONTRACT.md)). Retries was
documented there as not applicable (no retry mechanism exists). This
contract covers "AI cost" — and leads with a finding that changes the shape
of the work.

## Finding: there is no dollar AI cost to monitor, by design

Grepped the entire `app/` tree for `openai`, `anthropic`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`: zero matches. Read both LLM call
sites:

- `app/services/research_llm.py`'s `_call_local_model` posts to
  `{settings.research_llm_base_url}/api/generate` — `research_llm_base_url`
  defaults to `http://localhost:11434`, Ollama's default local port.
- `app/services/research_tradingagents.py`'s `_build_config` hardcodes
  `config["llm_provider"] = "ollama"` and points `backend_url` at the same
  local `research_llm_base_url` setting.

Both of this app's LLM paths are wired to a locally-hosted Ollama model,
never a billed cloud API. There is no per-token dollar cost anywhere in
this system today — reporting a "$0.00" or omitted cost field would be
accurate but not useful. This is a real finding, not a gap: nothing here
needs fixing, and no dollar-cost field should be invented or estimated.

## What "AI cost" still usefully means here: local compute load

Even with no dollar cost, operators still benefit from knowing how much
load the research/forecast pipeline puts on the local model server —
token volume and latency per job, so a capacity problem (the local Ollama
host getting slow or falling behind) is visible. Ollama's own
`/api/generate` response already includes `prompt_eval_count`,
`eval_count`, and `total_duration` (nanoseconds) fields; this app's
`_call_local_model` currently discards all three, keeping only
`response.json()["response"]`.

## What this adds

1. **Migration** (new revision, `down_revision = "c5a9e2d8b417"`, the
   current head): add three nullable columns to `research_jobs`:
   `prompt_tokens` (Integer), `completion_tokens` (Integer),
   `duration_ms` (Integer). Nullable because older rows and any call path
   that doesn't return these fields (e.g. the test fixture, or a future
   non-Ollama backend) must not break.
2. **`app/models/research_job.py`**: add the three matching nullable
   `Column(Integer, nullable=True)` fields.
3. **`app/services/research_llm.py`**: change `_call_local_model` to
   return the full parsed JSON body (not just `["response"]`), and have
   `generate_synthesis` pull `prompt_eval_count` → `prompt_tokens`,
   `eval_count` → `completion_tokens`, and `total_duration` (nanoseconds,
   convert to milliseconds: `// 1_000_000`) → `duration_ms` into its
   returned dict as three new optional keys, each defaulting to `None`
   via `.get(...)` if Ollama's response ever omits them (defensive — do
   not assume the field is always present).
4. **`app/services/research_worker.py`**: `process_one_job` currently does
   `ResearchReport(job_id=..., **synthesis_fields)` — `ResearchReport` has
   no `prompt_tokens`/`completion_tokens`/`duration_ms` columns and must
   not receive them as kwargs. Before that constructor call, when
   `backend != "tradingagents"`, pop the three new keys off
   `synthesis_fields` with `.pop(key, None)` and assign them directly onto
   `job` (`job.prompt_tokens = ...`, etc.) instead of passing them through.
   (`generate_tradingagents_synthesis` has no equivalent counts available
   from the `tradingagents` package's own return value — leave its jobs'
   three columns `NULL`, do not fabricate data for that path, and nothing
   needs popping on that branch since those keys are never added there.)
5. **`GET /compliance/ops-health`**: add one new top-level
   `ai_usage` object:
   ```json
   "ai_usage": {
     "research_jobs_with_token_counts": 3,
     "total_prompt_tokens": 1450,
     "total_completion_tokens": 820,
     "avg_duration_ms": 4120
   }
   ```
   Computed by summing/averaging `research_jobs` rows where
   `prompt_tokens IS NOT NULL` (completed-with-data rows only — rows with
   `NULL` columns, including every TradingAgents-path job and every job
   that predates this migration, are excluded, not counted as zero).
   `avg_duration_ms` rounds to the nearest integer; if zero rows have
   data, all four fields are `0`, not an error.

## What this does not do

- No dollar-cost estimate. No pricing table. No assumption that a future
  paid provider will report cost the same way — if this app later adds a
  billed LLM provider, that is a new, separate instrumentation unit.
- No backfill of historical rows; existing `research_jobs`/`forecast_jobs`
  rows keep `NULL` for the three new columns.
- `forecast_jobs` is untouched — the Kronos forecasting path
  (`docs/P6A_KRONOS_WRAPPER_CONTRACT.md`) is a local inference model, not
  an LLM call through `research_llm.py`, so it has no token counts to
  capture here; out of scope for this unit.

## Test plan

- `tests/test_research_llm.py`: extend the existing mocked-response test
  (and add one more) to assert `generate_synthesis` returns
  `prompt_tokens`/`completion_tokens`/`duration_ms` correctly converted
  when the mocked Ollama response includes `prompt_eval_count`,
  `eval_count`, `total_duration`; and that all three are `None` when the
  mocked response omits them (matching the existing fixture shape, so that
  test keeps passing unchanged apart from the added assertions).
- `tests/test_research_worker.py`: one new test asserting a completed
  research job persists the three columns from a mocked
  `generate_synthesis` result.
- `tests/test_p73_ops_health.py`: one new test seeding two `ResearchJob`
  rows with token counts and one without, asserting the new `ai_usage`
  block sums/averages only the rows with data, and one new test asserting
  the all-zero case when no rows have data.
- Full backend suite must still pass unchanged elsewhere.
