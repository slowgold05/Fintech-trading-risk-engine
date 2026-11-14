# Stage 7 follow-up — a crashed forecast worker leaves its job re-queued, not stuck

Continues Stage 7's exit-gate line, step 1, which names "worker restarts"
explicitly as one of the drills this stage requires. This had never been
tested for `app/services/forecast_worker.py`.

## What was found

Reading `_claim_job` and `process_one_job`: `_claim_job` sets
`job.status = "running"` and only `db.flush()`s it — it never commits.
`process_one_job` then runs the forecast inside `try/except Exception`,
and the single `db.commit()` for the whole lifecycle (claim through
completion or caught failure) happens only at the very end of the
function. This means claiming a job and recording its outcome are one
atomic transaction on that one session. If the worker process dies at
any point before that final commit — a crash, a kill, a machine
restart — nothing in that transaction was ever persisted, so the row
reverts to its last-committed state (`"queued"`) once the dropped
connection rolls the transaction back. No separate reclaim or
lock-expiry mechanism is needed, by construction.

## What changed

**No production code changed.** Dispatched to Grok as a test-only task
(scoped to `tests/test_forecast_worker.py` only), explicitly instructed
to report back rather than add any reclaim logic if the hypothesis above
turned out false. It held. One new test added:
`test_a_crashed_worker_leaves_its_claimed_job_re_queued_not_stuck`. It
claims a job directly via `_claim_job`, confirms it shows `"running"` in
memory, calls `db_session.rollback()` to stand in for the process dying
before its own commit, re-queries the job fresh and confirms it is back
to `"queued"`, then confirms `process_pending_forecast_jobs` can still
pick it up and process it normally afterward.

## Verification

- Grok's own test run was blocked by the same headless permission wall
  seen in the prior two units (`docs/P9G_STAGE7_MASSIVE_OUTAGE_RESILIENCE_VERIFICATION.md`,
  `docs/P9H_STAGE7_FORECAST_WORKER_OUTAGE_VERIFICATION.md`) — test
  execution and the full-suite rerun were done independently here.
- `git diff --stat` confirmed only `tests/test_forecast_worker.py`
  changed (one new import line for `ForecastJob` and `_claim_job`, plus
  the new test).
- `tests/test_forecast_worker.py`: **11 passed** (10 existing + this one).
- Full backend suite: **545 passed, 44 skipped**, same 6 pre-existing
  unrelated errors already documented (Windows `pytest-of-sbhav`
  temp-dir permission issue).
