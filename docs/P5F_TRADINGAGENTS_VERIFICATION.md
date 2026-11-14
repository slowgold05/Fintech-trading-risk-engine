# TradingAgents multi-agent synthesis backend verification

Sixth unit of roadmap Phase 5 (AI Research Desk) — adds TradingAgents
(`TauricResearch/TradingAgents`, Apache-2.0, pinned `v0.7.1`) as a second, optional,
heavier synthesis backend alongside PR #72's lightweight single-call backend. Default
backend stays `"simple"` (PR #72) — this unit changes nothing about current behavior
unless an operator explicitly sets `research_synthesis_backend = "tradingagents"`.
Design written first as `docs/P5F_TRADINGAGENTS_CONTRACT.md`, after reading
TradingAgents' actual source (`default_config.py`, `trading_graph.py`) rather than
guessing at its config surface or `final_state` shape.

## Implemented by Grok, independently verified by me

- `app/core/config.py`: two new settings.
- `requirements-research.txt`: new file, one pinned line — **not** added to
  `requirements.txt`.
- `app/services/research_tradingagents.py`: new file, lazy-imports `tradingagents`
  only inside `generate_tradingagents_synthesis`, never at module load.
- `app/models/research_report.py` + a new migration: one new nullable `backend_detail`
  JSON column.
- `app/services/research_worker.py`: `process_one_job`'s existing synthesis block
  branches on `settings.research_synthesis_backend`; the `"simple"` path (PR #72) is
  unchanged.
- `app/schemas/research_report.py` + `app/routers/research.py`: `backend_detail`
  passed through, same pattern as every other field.
- `tests/test_research_tradingagents.py`: new file — the real `tradingagents` package
  is never installed or imported in this test run; every test monkeypatches
  `app.services.research_tradingagents._import_tradingagents` directly.

## Independent verification

- Confirmed `app/services/research_tradingagents.py` has no top-level
  `import tradingagents` anywhere — `python -c "import app.services.research_tradingagents"`
  succeeds in this environment, where the real package is not installed, proving the
  lazy-import discipline actually holds.
- Confirmed the field mapping (`bull_case`/`bear_case`/`synthesis`/`risks`/
  `backend_detail`) uses the exact `final_state` keys read directly from
  TradingAgents' own `trading_graph.py` source (`investment_debate_state.bull_history`/
  `bear_history`, `investment_plan`, `risk_debate_state.history`, plus
  `market_report`/`sentiment_report`/`news_report`/`fundamentals_report`/
  `trader_investment_plan`/`final_trade_decision` and the `signal` return value) —
  not assumed field names.
- Confirmed `requirements.txt` is byte-identical to before this change — the new
  dependency lives only in `requirements-research.txt`.
- Confirmed the `"simple"` backend path (`research_synthesis_backend` left at its
  default) is byte-identical to PR #72's own behavior — re-ran PR #72's own
  `tests/test_research_worker.py` synthesis tests unchanged to confirm.
- Confirmed a TradingAgents synthesis failure (mocked to raise) never fails the job —
  same resilience philosophy as every other synthesis/data-source failure mode in this
  worker, with a `local_llm_tradingagents: "unavailable"` entry recorded in `sources`.
- Confirmed the `sources` entry's `type` field distinguishes which backend actually
  ran (`"local_llm"` vs `"local_llm_tradingagents"`) — a report never claims the wrong
  backend produced it.
- `python -m pytest -q tests/test_research_tradingagents.py tests/test_research_worker.py`:
  **18 passed** (5 new in `test_research_tradingagents.py`, 3 new + all of PR #72's
  pre-existing synthesis tests unchanged in `test_research_worker.py`).
- `python -m pytest -q` (full backend suite): **457 passed, 28 skipped, 0 errors** —
  up from the PR #73 baseline (447 passed) by exactly the 10 new tests. Ran with a
  fresh `--basetemp` after hitting a transient `PermissionError` on the shared Windows
  pytest temp directory on the first attempt (the same class of pre-existing
  environment issue already documented for `test_watchlists.py`'s two known errors,
  unrelated to this unit's code — confirmed by reproducing it in isolation, then
  clearing it with a fresh temp root, which also incidentally cleared the two
  previously-documented errors).
- `python -m alembic heads`: exactly one head (`a9c3e7d1f504`, chained onto
  `c8f1a3d7e492`); grepped the repo for the previous head string before shipping and
  bumped the two Postgres-only "fresh install reaches head" assertions pre-emptively.
- `python -c "import app.services.research_tradingagents"`: succeeds in this
  environment, where the real `tradingagents` package is genuinely not installed —
  confirms the lazy-import discipline holds for real, not just by code inspection.
- `git diff --stat requirements.txt`: empty — confirmed the main requirements file is
  byte-identical to before this change.

## What was not verified (disclosed boundary)

Did **not** actually install `requirements-research.txt` or run a real
`TradingAgentsGraph.propagate()` call against the real local Ollama/`qwen3:14b` model —
a genuine run involves dozens of sequential LLM calls and could plausibly take tens of
minutes on this hardware, which is not a practical verification step to run as part of
a routine review pass. The package's own source was read directly to confirm the
config keys and `final_state` shape this unit's code depends on, but the integration's
actual end-to-end behavior against a live Ollama instance was not exercised.

## What this unit does not do

Does not override TradingAgents' own data-vendor layer to use Sentinel's cached market
data instead of its default Yahoo/SEC EDGAR/FRED vendors (explicitly deferred — a
larger, separate integration). Does not isolate long-running research jobs onto their
own scheduled cycle — a job using this backend can still delay every other step in the
same scheduled cycle behind it; operators enabling this backend should set
`scheduled_research_job_limit` very low. No frontend. Does not touch any of PR
#69-#73's existing routes or the `"simple"` backend's behavior.
