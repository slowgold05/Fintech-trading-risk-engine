# Stage 7 follow-up — one scheduled step failing does not block the rest of the cycle

Stage 7 step 3: "Keep every provider and every AI feature independently
enableable — a Massive outage must not disable Finnhub quotes, and a
Kronos problem must not disable Tauric research." Reading
`app/services/scheduled_jobs.py::_run_scheduled_steps`, every one of its
eight steps (market-cache refresh, app controls, evidence backfill,
surveillance scan, AML scan, research jobs, daily briefs, forecast jobs)
already has its own `try/except Exception` with `db.rollback()` before
moving to the next step — this already satisfies the requirement by
construction, but nothing had ever proven it with a test. An existing
test, `test_only_one_scheduler_runs_the_cycle`, monkeypatches five of the
eight steps but never makes one raise and checks the rest still ran.

## What changed

**No production code changed.** Dispatched to Grok as a test-only task
(scoped to `tests/test_audit_fixes.py` only), reusing the existing
test's exact setup pattern. One new test added,
`test_a_failing_step_does_not_block_the_rest_of_the_cycle`: makes
`process_pending_research_jobs` raise `RuntimeError("simulated research
outage")`, and confirms every other step (`refresh`, `controls`,
`backfill`, `surveillance`, `aml`, `briefs`, `forecasts`) still ran in
the same cycle, in order, and that the scheduler lock was still released
cleanly afterward (`owner is None`, `next_due` advanced) — proving
`run_scheduled_cycle`'s `finally: release_scheduler(...)` ran even
though one step inside raised.

## Verification

- Grok's own test run was blocked by the same headless permission wall
  seen in prior units — test execution and the full-suite rerun were
  done independently here.
- `git diff --stat` confirmed only `tests/test_audit_fixes.py` changed.
- `tests/test_audit_fixes.py`: **24 passed** (23 existing + this one).
- Full backend suite: **549 passed, 44 skipped**, same 6 pre-existing
  unrelated errors already documented.

## What this does not do

Massive (`backfill_two_years`) is not wired into
`_run_scheduled_steps` at all yet — nothing schedules it — so "a Massive
outage must not disable Finnhub quotes" is not yet a reachable scenario
in this codebase; this unit proves the pattern that will make it true
once Massive is actually scheduled, using research-vs-the-rest as the
concrete stand-in available today.
