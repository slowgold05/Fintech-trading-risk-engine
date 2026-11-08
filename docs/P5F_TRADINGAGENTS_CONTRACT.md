# TradingAgents multi-agent synthesis backend contract

Roadmap Phase 5 section 5.2/8.1 names [TradingAgents](https://github.com/TauricResearch/TradingAgents)
(Apache-2.0, `TauricResearch/TradingAgents`, pinned to release **v0.7.1**) as the
proposed multi-agent research framework. PR #72 already ships a lightweight,
single-call local-model synthesis backend (`research_llm.py`). This unit adds
TradingAgents itself as a **second, optional, heavier synthesis backend** — selected by
config, not replacing PR #72's backend, which stays the default.

## What was actually inspected before writing this contract

Unlike most synthesis-shaped work, this wraps a real third-party framework, so its
actual source was read (not assumed) before design: `tradingagents/default_config.py`
(config keys, defaults — `max_debate_rounds`/`max_risk_discuss_rounds` already default
to `1`, satisfying "bounded" out of the box) and
`tradingagents/graph/trading_graph.py` (the exact `propagate()` signature and the exact
`final_state` keys `save_reports` itself reads: `investment_debate_state.bull_history`/
`bear_history`, `investment_plan`, `risk_debate_state.history`, `market_report`,
`sentiment_report`, `news_report`, `fundamentals_report`, `trader_investment_plan`,
`final_trade_decision`, plus the `signal` return value — Buy/Overweight/Hold/
Underweight/Sell/REVIEW). The field mapping below uses these exact keys, not guesses.

## Trade-execution risk — already structurally absent, not something to "disable"

The README's narrative describes a Portfolio Manager "approving" a trade that gets
"sent to the simulated exchange," but `trading_graph.py` has no such code path —
`propagate()` returns `(final_state, signal)`, a dict and a string, and does nothing
else. Our integration only ever reads that return value and writes it to a
`ResearchReport`; it is never passed to `order_book.place_order` or any execution path
anywhere in this codebase. The roadmap's "disable or exclude any upstream
trade-execution path" checklist item is satisfied by this absence, not by a feature
flag — there is no path to disable.

## What is explicitly deferred (disclosed, not solved here)

- **Point-in-time data adaptation.** The roadmap's own checklist asks to "adapt
  research inputs to approved Sentinel data snapshots" rather than letting
  TradingAgents hit Yahoo Finance/SEC EDGAR/FRED directly through its own data-vendor
  layer. Overriding that layer to read from Sentinel's own cached market data and
  `sec_service.py` would be a substantial separate integration (its `data_vendors`/
  `tool_vendors` config keys are the extension point, per `default_config.py` — a
  future unit's starting point, not solved here). This unit lets TradingAgents use its
  own default free/keyless vendors (yfinance, SEC EDGAR directly, FRED).
- **Runtime cost.** A single `propagate()` call runs several parallel analysts, a
  bull/bear debate, a risk-team debate, and a trader/portfolio-manager pass — dozens of
  sequential LLM calls through a local 14B model, each potentially 10-60+ seconds. A
  single job using this backend can plausibly take tens of minutes. **Operators who
  enable this backend should set `scheduled_research_job_limit` very low (e.g. `1`)** —
  this unit does not change the scheduler's own execution model (still one job at a
  time, still inside the same single scheduled cycle), so a long-running job using this
  backend delays every other scheduled step (market refresh, controls, surveillance,
  AML) behind it. A future unit might move research processing to its own
  independently-scheduled cycle; that is not built here.

## New setting: `app/core/config.py`, added directly below the existing
`scheduled_daily_brief_limit` line

```python
research_synthesis_backend: str = "simple"  # "simple" or "tradingagents"
research_tradingagents_data_dir: str = "./var/tradingagents"
```

`research_synthesis_backend` only matters when `research_synthesis_enabled` (PR #72)
is also `True` — the existing flag remains the master on/off switch; this setting picks
which of the two backends runs. Default `"simple"` means this unit changes **nothing**
about current behavior unless an operator explicitly opts into the heavier backend.
`research_tradingagents_data_dir` keeps TradingAgents' own cache/results/memory-log
files inside this app's own directory tree, not the default `~/.tradingagents` in the
server's home directory — self-contained and removable.

## New optional dependency file: `requirements-research.txt` (new, separate from
`requirements.txt`)

```
tradingagents @ git+https://github.com/TauricResearch/TradingAgents.git@v0.7.1
```

**Not added to `requirements.txt`.** This is a heavy dependency (LangGraph plus every
provider SDK it supports) that CI's default install must never pull in — the same
"invisible by default" principle as `research_synthesis_enabled` itself, extended to
the dependency surface. An operator who wants this backend installs this file
separately (`pip install -r requirements-research.txt`) on top of the base install.

## New service: `app/services/research_tradingagents.py`

- `_import_tradingagents()`: a **lazy** import (inside the function, not at module load
  time) of `tradingagents.graph.trading_graph.TradingAgentsGraph` and
  `tradingagents.default_config.DEFAULT_CONFIG`. Raises a plain `RuntimeError` with a
  clear message if the package is not installed — this module must be importable (and
  every other module that imports it must work) even when `tradingagents` itself is
  not installed, since it is not in the base `requirements.txt`.
- `_build_config(base_dir: Path) -> dict`: starts from `DEFAULT_CONFIG.copy()`, sets
  `llm_provider = "ollama"`, `backend_url = f"{settings.research_llm_base_url}/v1"`
  (TradingAgents' Ollama provider expects the `/v1` suffix, per its own README — not
  the bare base URL PR #72's own `research_llm.py` uses for its direct `/api/generate`
  call), `deep_think_llm` and `quick_think_llm` both set to `settings.research_llm_model`
  (one local model family available; no need for separate quick/deep tiers),
  `max_debate_rounds = 1`, `max_risk_discuss_rounds = 1` (explicit, even though these
  already default to `1` — explicit is clearer than relying on a library default that
  could change), and `results_dir`/`data_cache_dir`/`memory_log_path` all pointed
  inside `base_dir`.
- `generate_tradingagents_synthesis(symbol: str, as_of_date: str) -> dict`: imports,
  ensures `settings.research_tradingagents_data_dir` exists
  (`Path(...).mkdir(parents=True, exist_ok=True)`), builds the config, constructs
  `TradingAgentsGraph(debug=False, config=config)`, calls
  `graph.propagate(symbol, as_of_date)` → `(final_state, signal)`. Maps:
  - `bull_case` ← `final_state["investment_debate_state"]["bull_history"]`
  - `bear_case` ← `final_state["investment_debate_state"]["bear_history"]`
  - `synthesis` ← `final_state["investment_plan"]` (the Research Manager's own synthesis
    after the bull/bear debate — not the Trader's or Portfolio Manager's plan, which go
    into `backend_detail` instead; `investment_plan` is the closest match to this
    field's existing meaning in PR #72's own simple backend)
  - `risks` ← `final_state["risk_debate_state"]["history"]` (the full risk-team debate
    transcript)
  - `model_version` ← `settings.research_llm_model`
  - `prompt_version` ← the literal string `"tradingagents-v1"` (distinct from PR #72's
    `research_prompt_version` setting — this backend's "prompt" is TradingAgents' own
    internal agent prompts, which this codebase does not author or version; `v1` names
    *this integration's* field-mapping version, bumped if the mapping above ever
    changes, not TradingAgents' own internal prompts)
  - `backend_detail` ← a dict of everything else worth keeping:
    `{"signal": signal, "market_report": ..., "sentiment_report": ..., "news_report":
    ..., "fundamentals_report": ..., "trader_investment_plan": ...,
    "final_trade_decision": ...}` (`.get(...)`, not `[...]`, for every key here — a
    partial `final_state` from an interrupted run should not crash this function).
  Raises on any failure (missing package, LangGraph/Ollama failure, malformed
  `final_state`) — same "the caller decides what a failure means" contract as PR #72's
  `generate_synthesis`.

## New column: `app/models/research_report.py`

```python
backend_detail = Column(JSON, nullable=True)
```

Added via a new migration chaining onto the current head (`c8f1a3d7e492`, PR #73's
research-briefs migration). `None` for every report produced by the `"simple"` backend
(including every report ever produced before this unit) or when synthesis is disabled
entirely — only populated when the `"tradingagents"` backend actually ran.

## Changes to `app/services/research_worker.py`

Inside `process_one_job`'s existing `if settings.research_synthesis_enabled:` block
(added in PR #72), branch on `settings.research_synthesis_backend`:

- `"simple"` (default): call PR #72's existing `generate_synthesis(job.symbol,
  sources)` exactly as today — **byte-identical behavior to PR #72**, including the
  `local_llm` entry appended to `sources` on success/failure. `backend_detail` stays
  `None`.
- `"tradingagents"`: call
  `generate_tradingagents_synthesis(job.symbol, as_of_date=_now().date().isoformat())`
  instead. On success, populate `backend_detail` from its result alongside the four
  text fields, and append `{"type": "local_llm_tradingagents", "status": "ok",
  "detail": f"synthesis generated via tradingagents ({settings.research_llm_model})"}`
  to `sources` (a **different** `type` string than the simple backend's `"local_llm"`,
  so a report's `sources` list always says which backend actually produced it). On
  failure, append `{"type": "local_llm_tradingagents", "status": "unavailable",
  "detail": exc.__class__.__name__}`; every synthesis field (including
  `backend_detail`) stays `None`, same resilience philosophy as every other failure
  mode in this worker — the job still reaches `"completed"`.
- Any other value of `research_synthesis_backend` is unreachable in practice (the
  setting only has two documented values) — no explicit `else` branch is required, but
  do not let an unrecognized value silently do nothing; raise inside the synthesis
  `try` block (which the existing `except` already catches and records as an
  `"unavailable"` entry) rather than letting it reach the `ResearchReport` constructor
  with undefined fields.

## New schema field: `app/schemas/research_report.py`

Add `backend_detail: dict | None` to `ResearchReportOut`. `app/routers/research.py`'s
`_report_out` helper passes it straight through, same as every other field.

## What this unit does not do

Does not override TradingAgents' own data-vendor layer to use Sentinel's cached data
(explicitly deferred above). Does not change the scheduler's execution model to isolate
long-running jobs onto their own cycle. Does not add this dependency to
`requirements.txt` — an operator must install `requirements-research.txt` separately to
use this backend at all. No frontend. Does not touch any of PR #69-#73's existing
routes, the `"simple"` backend's own behavior when selected (still PR #72, unchanged),
or any report produced before this unit (all have `backend_detail: null` already,
consistent with the new column's nullable default).
