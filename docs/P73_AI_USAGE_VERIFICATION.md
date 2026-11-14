# Phase 7.3 — AI usage instrumentation verification

Contract: [P73_AI_USAGE_CONTRACT.md](P73_AI_USAGE_CONTRACT.md).

## Addendum, 2026-11-09: confirmed against a real, live local Ollama

Everything below this line was verified with the Ollama response fields
mocked (the only option while Docker/Ollama weren't running). Once the
user started Ollama locally, ran `generate_synthesis("AAPL", sources)`
directly against the real local `qwen3:14b` model (the app's own
configured default — already pulled locally, not downloaded for this
check) with no mocking at all:

```
wall_clock_seconds: 97.12
prompt_tokens: 74
completion_tokens: 567
duration_ms: 95046
```

`duration_ms` (95.0s) matches the measured wall-clock time (97.1s)
within the expected small overhead, and `bull_case`/`synthesis` both
parsed correctly from the real model output. This confirms the field
names read from Ollama's actual `/api/generate` response
(`prompt_eval_count`, `eval_count`, `total_duration`) are correct against
the real API, not just assumed from documentation — this is a real
confirmation that was not possible earlier in this session.

## Diff scope

`git status --short` after Grok's implementation shows exactly the files
granted: the new migration
`alembic/versions/45d85a1871f0_add_research_job_ai_usage_columns.py`, and
modifications to `app/models/research_job.py`,
`app/services/research_llm.py`, `app/services/research_worker.py`,
`app/routers/compliance.py`, `tests/test_research_llm.py`,
`tests/test_research_worker.py`, `tests/test_p73_ops_health.py`. No other
file touched.

## Logic review

- Migration: `down_revision = "c5a9e2d8b417"`, confirmed to be the actual
  pre-change `alembic heads` output before this unit started. Adds the
  three nullable `Integer` columns to `research_jobs` exactly as specified,
  with a matching `downgrade()`.
- `research_llm.py`: `_call_local_model` now returns the full parsed
  response body instead of just `["response"]`; `generate_synthesis` reads
  `body["response"]` for the text (unchanged behavior) and adds
  `prompt_tokens`/`completion_tokens`/`duration_ms` via `.get()` on
  `prompt_eval_count`/`eval_count`/`total_duration`, converting nanoseconds
  to milliseconds with integer division — matches the contract exactly,
  including the `None`-when-missing fallback required for the existing
  test fixture (which doesn't model these fields) to keep passing.
- `research_worker.py`: caught the exact bug flagged before dispatch —
  the three new keys are `.pop()`-ped off `synthesis_fields` before
  `ResearchReport(**synthesis_fields)` is constructed, and assigned
  directly onto `job` instead. Confirmed by reading the diff: the pop
  calls appear only inside the non-`tradingagents` branch, so the
  TradingAgents path's `ResearchJob` rows correctly keep all three columns
  `NULL`.
- `compliance.py`'s new `_ai_usage` helper filters on
  `ResearchJob.prompt_tokens.is_not(None)` for count/sum/avg together (one
  query, one `WHERE`), and returns the explicit all-zero dict when
  `count == 0` rather than letting `None` leak through from `func.avg` on
  an empty set — matches the contract's "all four fields are 0, not an
  error" requirement.

## Test verification

Independently reran (not trusting Grok's self-report alone — Grok's own
run hit the project's known Windows pytest-temp-dir `PermissionError` flake
and its own retry attempt was correctly blocked by the permission
classifier since it needed `icacls`/`Get-Item` outside its granted scope):

- `tests/test_research_llm.py` + `tests/test_research_worker.py` +
  `tests/test_p73_ops_health.py` together, fresh `--basetemp`:
  **27 passed**.
- Full backend suite, fresh `--basetemp`: **510 passed, 29 skipped, zero
  failures.**

Each new/modified test maps to the contract's "Test plan" one-to-one:
Ollama usage-field conversion (including the missing-fields case already
covered by the pre-existing fixture), a worker test asserting the three
columns land on the `ResearchJob` row (not on `ResearchReport`), and two
`ops-health` tests — one summing/averaging only rows with data, one
asserting the explicit zero case.

## What was not, and could not be, verified here

The migration file itself was not applied against a live database — this
project's own test fixtures build the schema via
`Base.metadata.create_all` (SQLAlchemy ORM metadata), not by running
Alembic migrations, so no test in this suite ever exercises
`alembic upgrade head` either for this migration or any other one already
in the repo. Applying this migration against a disposable PostgreSQL
instance was not possible in this session for the same reason already
disclosed in Phase 0's re-check: Docker is not running in this sandboxed
environment and was not started unattended. The migration's `upgrade()`/
`downgrade()` bodies were instead verified by direct code review against
the column types and the existing migration-file style.
