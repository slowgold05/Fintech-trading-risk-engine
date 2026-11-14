# Local-model research synthesis contract

The fourth and final currently-scoped unit of roadmap Phase 5 (AI Research Desk) for
this pass. PR #71's worker already produces a `sources`-only report with every
AI-synthesis field `null`. This unit fills in `bull_case`/`bear_case`/`synthesis`/
`risks`/`model_version`/`prompt_version` — using a **local, cost-free model via
Ollama** (the user's explicit choice: `qwen3:14b`, already pulled and running on this
machine at `http://localhost:11434`), not a paid API and not TradingAgents. This is
still not the TradingAgents framework itself — it is a direct, single-call local-LLM
synthesis step over the data PR #71's `_gather_sources` already assembled.

## Why gated behind a setting, default off

Ollama is not running in CI and will not be on most machines that deploy this app.
`research_synthesis_enabled` (new setting, default `False`) must be explicitly turned
on (an env var) by whoever runs the server with Ollama available. With it off — the
committed default, and every CI run — this unit's code paths are simply never
exercised in production routes; behavior is byte-identical to PR #71. Every existing
test must keep passing unchanged with the flag at its default.

## New settings: `app/core/config.py`, added directly below the existing
`scheduled_research_job_limit` line

```python
research_synthesis_enabled: bool = False
research_llm_base_url: str = "http://localhost:11434"
research_llm_model: str = "qwen3:14b"
research_llm_timeout_seconds: float = Field(default=120, gt=0, le=600)
research_prompt_version: str = "v1"
```

`research_prompt_version` exists so a future change to the prompt template below is
traceable on every report it touches — the same reasoning the roadmap's own report
schema already calls out this field for.

## New service: `app/services/research_llm.py`

- `_MARKERS` / `_KEY_BY_MARKER`: four literal markers, `"BULL CASE:"`, `"BEAR CASE:"`,
  `"SYNTHESIS:"`, `"RISKS:"`, each mapped to its report field name.
- `_build_prompt(symbol: str, sources: list[dict]) -> str`: a plain-text prompt
  describing the symbol and summarizing the `sources` list (what data was actually
  gathered, and whether each was `"ok"` or `"unavailable"` — the model should know what
  it does and does not have), then instructs the model to respond using **exactly**
  the four markers above, each followed by its own paragraph, in any order (the parser
  below does not require a specific order — see Reference 3).
- `_call_local_model(prompt: str) -> str`: `requests.post(f"{settings.research_llm_base_url}/api/generate",
  json={"model": settings.research_llm_model, "prompt": prompt, "stream": False},
  timeout=settings.research_llm_timeout_seconds)`, `raise_for_status()`, returns
  `response.json()["response"]`. Any `requests.RequestException`, timeout, or malformed
  response propagates to the caller — this function does not swallow errors itself.
- `_parse_sections(text: str) -> dict`: finds each marker's position with `text.find(...)`
  (skip markers not present at all), sorts the found markers by their actual position in
  the text (**not** by the fixed order `_MARKERS` lists them in — a model that emits
  them in a different order must still parse correctly**, each section's content is
  the text between its own marker and the next found marker (or end of string for the
  last one), `.strip()`'d; a marker not found at all leaves that key `None`; empty
  content after stripping also becomes `None`. See the four hand-verified reference
  vectors below.
- `generate_synthesis(symbol: str, sources: list[dict]) -> dict`: builds the prompt,
  calls the model, parses the response, returns
  `{"bull_case": ..., "bear_case": ..., "synthesis": ..., "risks": ...,
  "model_version": settings.research_llm_model, "prompt_version":
  settings.research_prompt_version}`. **Raises** (does not catch) on any failure in the
  call or an empty/unparseable response — the caller (`research_worker.py`) decides
  what a failure means for the job, exactly like `_gather_sources`'s own two calls each
  decide independently.

### Reference vectors for `_parse_sections` (hand-verified independently before
implementation; the markers' exact positions are what's being tested, not model
quality)

**Reference 1 — well-formed, in the instructed order:**
```
BULL CASE:
Strong recent revenue growth and a healthy balance sheet support upside.

BEAR CASE:
Margins have compressed and competitive pressure is rising.

SYNTHESIS:
Overall a cautiously positive setup given the growth trajectory.

RISKS:
Macro headwinds and regulatory filings show increased litigation exposure.
```
→ all four fields populated with exactly the text between their marker and the next
one, stripped.

**Reference 2 — `RISKS:` marker entirely missing:** the other three parse normally;
`risks` is `None` (not an error, not an empty string).

**Reference 3 — markers present but in a different order than instructed**
(`SYNTHESIS`, `BULL CASE`, `RISKS`, `BEAR CASE`): all four still parse correctly,
each getting exactly its own section's text — proves the parser sorts by actual text
position, not by assuming the model followed the instructed order.

**Reference 4 — no markers at all** (model ignored the format entirely): all four
fields are `None`. This is a legitimate, non-crashing outcome — `generate_synthesis`
still returns a dict (not an error) in this case; a completely unparseable response is
not treated as a call failure, just as a report with no usable sections (same spirit as
a data source coming back `"unavailable"` elsewhere in this worker).

## Changes to `app/services/research_worker.py`

Inside `process_one_job`, after `sources = _gather_sources(db, job.symbol)` and before
building the `ResearchReport`: if `settings.research_synthesis_enabled` is true, call
`generate_synthesis(job.symbol, sources)` in its **own** `try`/`except`, independent of
everything else in this function:

- On success: use its four text fields and `model_version`/`prompt_version` when
  constructing the `ResearchReport`; append `{"type": "local_llm", "status": "ok",
  "detail": f"synthesis generated via {settings.research_llm_model}"}` to `sources`.
- On failure (any exception): the report's AI fields stay `None` and
  `model_version`/`prompt_version` stay `None` (exactly like today), and append
  `{"type": "local_llm", "status": "unavailable", "detail":
  exc.__class__.__name__}` to `sources`.
- If the flag is false: skip entirely — no `local_llm` entry is added to `sources` at
  all, and the report is byte-for-byte what PR #71 already produces. This is the path
  every existing test and all of CI exercises.
- The job still always reaches `"completed"` regardless of synthesis outcome — a failed
  or skipped synthesis is not a job failure, same philosophy as a failed data source.

## What this unit does not do

No TradingAgents framework integration — this is a single, direct local-model call,
not a multi-agent system. No retry of a failed synthesis call. No per-job model
override (the model is a server-wide setting). No frontend. Does not touch
`GET /research/filings/{symbol}` (PR #69), the job intake routes (PR #70), or
`_gather_sources`/the data-source-only path (PR #71) when the new flag is off.
