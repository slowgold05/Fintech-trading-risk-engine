# Phase 2 changes — 2026-11-03

This note records the code and document changes made to close the operating gaps in Phase 2 of the GRC roadmap. Phase 2 is the control framework: a control runner, pre-trade limits, roles, a risk register, and a compliance console that can show whether those controls actually ran.

The live Lightsail service was not updated. AWS CLI 2.39.3 is installed, but it has no credentials, so the new image was not built or deployed. Docker is running. The public API health check still returned `200` on the existing image. Live operating samples were written to that database on 2026-11-03; the compliance console cannot show them until the new image is deployed.

The hosted deploy stays on hold. `aws login` was not run. Phase 3 work continues in the working tree and is recorded in `docs/PHASE3_CHANGES.md`.

## Why these changes exist

The compliance console reads control results from the API container. The passing 2026-10-31 operator run wrote its JSON files on another machine. The container could not see them, so every control showed `not_run`.

Hosted quote refresh and ledger reconciliation were also manual. Quotes from 2026-10-30 become unusable for the price band after seven calendar days. The database is private, so a job on a developer laptop cannot reach it. The API container already can.

Three risks in the register had no check even though the product already had the data to test them: a missed quarterly access review, evidence that an operator can edit, and a buy reservation larger than the cash balance.

## Evidence the console can read

**New table `control_evidence`.** Migration `alembic/versions/1c4e8a7b2d90_add_control_evidence.py` adds the table. Each row stores the control id, the run time, the canonical JSON payload, and the SHA-256 of that payload. On PostgreSQL, a trigger rejects `UPDATE` and `DELETE`. The model is `app/models/control_evidence.py`.

**Purpose.** The database is the shared store between the operator, the scheduled job, and the API. The application login may insert rows. It is not granted update or delete. `app/scripts/configure_postgres_role.py` adds `GRANT INSERT ON control_evidence`. `SELECT` still comes from the existing grant on all tables. Run the grant script again after this migration. The script can take the app password from `DATABASE_URL` when `POSTGRES_APP_PASSWORD` is unset, which is what the hosted entrypoint needs.

**Writes.** `app/services/control_evidence.py` still writes a JSON file under `grc/evidence/` for the local working copy. When a database session is passed, it also inserts the same payload. `reconcile_ledger`, `check_market_data`, and `check_role_audit` now pass that session. The role-audit script writes the row with the application login, not the migration login, so the console is allowed to read it.

**Reads.** `GET /compliance/controls` prefers the newest database row. It reports `evidence_error` if the stored hash does not match the payload. If the table does not exist yet, it falls back to the JSON files, so an old database does not take the console down. `GET /compliance/risks` uses the same results. Residual risk still drops one level only when every linked control passed within 36 hours.

**Backfill.** If a control has files but no database row, `backfill_missing_file_evidence` can copy the latest file in. The scheduler calls this after it writes fresh rows, so an older file does not cover a newer run. Repository controls such as SM-CM-01 and SM-SM-01 can appear this way when their files are present. They are not run inside the API container.

## Scheduled refresh, reconciliation, and control runs

**Settings** in `app/core/config.py`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `SCHEDULED_JOBS_ENABLED` | `false` | Turns the in-process scheduler on. Leave it off for local Compose. |
| `SCHEDULED_JOB_INTERVAL_HOURS` | `24` | Time between cycles after the first one. |
| `SCHEDULED_MARKET_HOT_LIMIT` | `200` | Maximum hot-tier symbols refreshed in one cycle, in batches of 50. |
| `SCHEDULED_MARKET_DAILY_LIMIT` | `100` | Maximum daily-tier symbols refreshed in one cycle. |

**Job.** `app/services/scheduled_jobs.py` starts a daemon thread from the FastAPI lifespan in `app/main.py` only when the flag is true. The first cycle waits about 20 seconds so the process can pass its health check. Each cycle refreshes end-of-day quotes, runs the application-role controls, then backfills any missing file evidence. A failure in one step is logged and does not stop the API.

The job does not run SM-AC-02. That check updates a role with the migration login and rolls the change back. Putting the migration password in the public API container would undo the role separation. An operator still runs `python -m app.scripts.run_controls` for the full set.

**Container start.** `deploy/entrypoint.sh` is the image command. When `RUN_DB_SETUP=true`, it runs `alembic upgrade head` and `configure_postgres_role` before Uvicorn. Use that flag for one deployment, then deploy again without `MIGRATION_DATABASE_URL` and with `SCHEDULED_JOBS_ENABLED=true`. The Dockerfile copies the script and runs it as the non-root `app` user.

**Local Compose** keeps its own startup command and sets `SCHEDULED_JOBS_ENABLED` to false. A local `docker compose up` still migrates and reapplies grants. It does not call Yahoo on a timer.

## Controls added to the runner

`app/scripts/run_controls.py` now records ten controls. The scheduled job records the same list except SM-AC-02.

| ID | What it checks | Why it was added |
| --- | --- | --- |
| SM-AC-03 | Every account has an independent review this quarter, and the review still matches the current role and latest role-change row. | R-15 had no control. The review screens existed, but nothing failed the run when the quarter was empty. |
| SM-EV-01 | A zero-row update and a zero-row delete of `control_evidence` are denied. | R-12 had no control. File evidence on a laptop can be edited. The denial is the operating check. |
| SM-PT-06 | Cash reserved by open buy orders does not exceed `cash_balance`. | R-11 had no control. Order entry already rejects an oversized buy. This check detects a reservation that got past that rule. |

SM-MD-01 was linked to R-14. A provider outage shows up as missing or stale hot-tier quotes, which that check already measures.

R-08 (the migration login can change triggers), R-09 (one user reads another user's data), and R-13 (credential stuffing) are still unmapped. Isolation is covered by tests, not by a daily operating check. Login limits are still in process memory.

Definitions are in `grc/controls/SM-AC-03.yaml`, `SM-EV-01.yaml`, and `SM-PT-06.yaml`. Workpapers are in `grc/workpapers/`. `grc/control_matrix.csv` was regenerated from those files and now lists 14 controls. `grc/risk_register.yaml` points R-11 at SM-PT-06, R-12 at SM-EV-01, R-14 at SM-MD-01, and R-15 at SM-AC-03.

The access-review check lives in `app/services/access_review_check.py`. The buying-power check lives in `app/services/buying_power_check.py`. The evidence probe reuses the privilege-denial helper in `app/services/access_control_check.py`. On PostgreSQL the denial is either insufficient privilege (`42501`) or the append-only trigger (`P0001`). On SQLite, which has no roles, the probe correctly fails.

## Operating-sample command

`app/scripts/collect_operating_samples.py` talks only to the HTTP API. It does not open a database connection.

It expects `ADMIN_EMAIL` and `ADMIN_PASSWORD`. For the compliance officer it accepts either `COMPLIANCE_EMAIL` / `COMPLIANCE_PASSWORD` or the names already used in the ignored bootstrap file, `COMPLIANCE_OFFICER_EMAIL` / `COMPLIANCE_OFFICER_PASSWORD`. If no trader is supplied, it registers a new `phase2-ops-…@example.com` account and writes the password to ignored `.env.phase2-sample`. A later run reuses that file. A registration failure does not skip the halt or the access review. The order step reads up to 1,000 heatmap rows and skips stale quotes.

The command:

1. Halts trading with a reason, then resumes it, and tries again in a `finally` block so a crash does not leave the halt on.
2. Places a one-share limit buy at 90 percent of a cached quote between $10 and $500, so the order can rest inside the 20 percent band. It repeats the request with the same `Idempotency-Key`. If the create call returns 200, the replay must return the same order id. If the running image returns 500 after committing, the command lists the account's orders and requires exactly one new open order after the retry.
3. Records a `retain` decision for every unreviewed account except the reviewer's own. The compliance officer and the admin review each other.

Live result on 2026-11-03, against the current public API:

- Trading was halted with reason `SM-PT-01 operating sample` and then resumed. The resume response reported trading open, and the command exited only after that check.
- Q4 2026 access review submitted 13 `retain` decisions. A second run found no unreviewed accounts. Decisions were retain only, with the reason `Q4 2026 phase-2 review. Demo account retained. No role change.`
- One open order remains: NVDA, buy 1 share, limit $184.18, order id 1. That price is 90 percent of the cached $204.64 quote dated 2026-10-30. The idempotent retry left that single order in place. Both create calls returned HTTP 500 because of the rate-limit header bug below. The order list is what shows the retry did not create a second order.
- The trader password is only in ignored `.env.phase2-sample`. An earlier probe of `phase2-probe@example.com` also committed an account before the 500, and that password was not saved. The quarterly review retained it.

The public heatmap on the same day had 68 cached quotes dated 2026-10-30 or 2026-10-28, which the price band still accepts. 496 quotes were still dated 2026-07-02 and are stale. The order sample used a cached October quote. The rest of the book still needs the hosted refresh job.

## Registration and order 500

`POST /auth/register` on the live API returned a plain `Internal Server Error` after the account had already been saved. Login with the same password then succeeded. A local PostgreSQL 17 database with the same app-role grants reproduced it.

slowapi writes rate-limit headers after the handler returns. With headers enabled, it requires the handler to take `response: Response`. `register`, `create_order`, `cancel`, and `create_trade` did not. The wrapper raised `parameter response must be an instance of starlette.responses.Response` after the database commit. Login already had that parameter, so login kept working. Tests set `RATE_LIMIT_ENABLED=false`, so they did not catch it.

Those four handlers now accept `response`. `tests/test_rate_limit.py` turns the limiter on and expects register to return 200 with an `x-ratelimit-limit` header. The same local database then returned 200 for a new registration. The running Lightsail image does not have this fix, so a successful register, order, or direct trade there still ends in HTTP 500 after the row is saved.

## Tests

`tests/test_phase2_controls.py` covers database evidence overriding a file, a bad evidence hash, the access-review check, the buying-power breach, the SQLite evidence probe, and the order of a scheduled cycle.

`tests/test_run_controls.py` expected the ten-control runner when this note was written. `tests/test_control_matrix.py` expected 14 exported controls. Phase 3 adds SM-SV-05 and R-17, so those tests now expect 15 controls and 17 risks. See `docs/PHASE3_CHANGES.md`.

`python -m pytest -q` passed: 74 tests.

## Documents updated to match the code

These files describe the new behavior and state that the running Lightsail image does not include it yet:

- `readme.md`
- `Architecture.md`
- `Security.md`
- `docs/aws_deployment.md`
- `docs/GRC_ACTION_ITEMS.md`
- `.env.example`, with the four scheduler settings

The access-control policy now names SM-AC-03. The change-management policy now names the append-only evidence table. Both policies stay drafts. They were not marked approved. The Alpha Vantage incident file was not changed, because provider revocation evidence is still not attached.

An uncommitted rewrite of `app/scripts/export_controls.py` and `requirements.txt` was restored before this work. That rewrite skipped invalid controls and required pandas. The existing test requires the exporter to reject an incomplete control. Those two files are back to the committed versions.

## What still has to happen

The hosted deploy stays deferred. `aws login` was not run, and the Lightsail image was not replaced. The list below is the deploy that is ready when it is requested. It is not the next task. Phase 3 surveillance is in this working tree and is recorded in `docs/PHASE3_CHANGES.md`. Phase 4 authenticator and login-risk work is recorded in `docs/PHASE4_CHANGES.md`. Phase 5 AML, sanctions, and incidents are recorded in `docs/PHASE5_CHANGES.md`. Phase 6 tabletop, SAR drafts, and the artifact pack are recorded in `docs/PHASE6_CHANGES.md`. That code is also not deployed.

1. Sign in to AWS. This machine has AWS CLI 2.39.3 and no credentials. `aws login` provides short-term credentials that rotate about every 15 minutes. Docker is already running.
2. Build the API image, deploy once with `RUN_DB_SETUP=true`, then deploy again without the migration URL and with `SCHEDULED_JOBS_ENABLED=true`. That image includes the rate-limit response fix, migrations `1c4e8a7b2d90`, `a8d3c1e4b672`, `b7e2a9c4d815`, `c4d8e1a7b936`, `d5e9f2b8c047`, `e7b2c5d9a174`, and `f3a8c2d7e961`, the surveillance files, the AML files, the sanctions fixture, the KRI file, the asset inventory, and `grc/signals/accounts.yaml`. Re-run `python -m app.scripts.configure_postgres_role` in that setup step so the new tables are granted. New registrations and orders should then return 200. Leave `MFA_REQUIRED` false until every hosted account has enrolled. An unenrolled book fails SM-AC-04, and that failure is expected. Leave `YENTE_URL` empty. The fixture is not a sanctions list. Leave the expansion provider keys empty. Empty keys do not call Massive, Finnhub, or Twelve Data.
3. After the first scheduled cycle, confirm the compliance console shows database evidence for the halt sample, the open NVDA order, and the idempotent retry. SM-AC-03 should pass for the quarter that was just reviewed. SM-MD-01 passes only for quotes the job actually refreshes. 496 symbols are still dated 2026-07-02. Surveillance cases stay empty until a second approver activates a rule.
4. Owner approval of the draft policies, an evidence copy outside the database, and the Alpha Vantage revocation record remain separate owner actions. Draft PR #1 was merged on 2026-11-02. The model-risk policy is also still pending review.

Until that deploy, the public console still shows `not_run`. The halt events, the Q4 reviews, and NVDA order 1 are already in the hosted database.
