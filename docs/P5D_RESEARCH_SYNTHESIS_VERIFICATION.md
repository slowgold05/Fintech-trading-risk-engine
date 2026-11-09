# Local-model research synthesis verification

Fourth unit of roadmap Phase 5 (AI Research Desk) — fills in the AI-synthesis fields
PR #71 always left `null`, using a local, cost-free model via Ollama (`qwen3:14b`, the
user's explicit choice) rather than a paid API or TradingAgents itself. Gated behind
`research_synthesis_enabled` (default `False`) so CI and every existing test are
unaffected. Design written first as `docs/P5D_RESEARCH_SYNTHESIS_CONTRACT.md`.

## Implemented by Grok, independently verified by me

- `app/core/config.py`: five new settings.
- `app/services/research_llm.py`: new file, `generate_synthesis` and its helpers
  (`_build_prompt`, `_call_local_model`, `_parse_sections`).
- `app/services/research_worker.py`: `process_one_job` extended with one new
  conditional block (synthesis), gated on `settings.research_synthesis_enabled`; the
  `_gather_sources`/report-completion logic PR #71 shipped is otherwise untouched.
- `tests/test_research_llm.py`: new file (pure `_parse_sections` unit tests, the four
  reference vectors).
- `tests/test_research_worker.py`: extended with synthesis-enabled/disabled cases; all
  of PR #71's own existing tests in this file untouched and still passing.

## Independent verification

- Re-derived all four `_parse_sections` reference vectors in a standalone script
  before review (well-formed, missing marker, out-of-order markers, no markers at
  all). All four matched the contract exactly.
- Confirmed no real network call to `localhost:11434` happens anywhere in the test
  suite — every test either leaves `research_synthesis_enabled` at its default `False`
  or monkeypatches `generate_synthesis`/`requests.post` directly; at least one test
  asserts `requests.post` raises if called while the flag is off, proving the gate
  actually gates.
- Confirmed a synthesis failure (model unreachable, timeout, bad response) never fails
  the job — the job still reaches `"completed"`, with the AI fields `None` and a
  `local_llm: "unavailable"` entry in `sources`, same resilience philosophy as the two
  existing data sources.
- Confirmed the flag-off path produces a report byte-identical to what PR #71 already
  produced (no `local_llm` entry in `sources` at all) — re-ran PR #71's own
  `tests/test_research_worker.py` tests unchanged to confirm this.
- `python -m pytest -q tests/test_research_llm.py tests/test_research_worker.py`:
  **15 passed** (5 new in `test_research_llm.py`, 3 new + 7 unchanged pre-existing in
  `test_research_worker.py`).
- `python -m pytest -q` (full backend suite): **439 passed, 28 skipped** — up from the
  PR #71 baseline (431 passed) by exactly the 8 new tests; same 2 pre-existing
  unrelated Windows-local SQLite-locking errors.
- No new migration — this unit adds no schema (`python -m alembic heads` still shows
  `b6e2d9a4c175`, PR #71's own head, unchanged).

## What this unit does not do

No TradingAgents framework integration. No retry of a failed synthesis call. No
per-job model override. No frontend. Does not touch `GET /research/filings/{symbol}`
(PR #69), the job intake routes (PR #70), or the data-source-only path (PR #71) when
`research_synthesis_enabled` is left at its default `False`.
