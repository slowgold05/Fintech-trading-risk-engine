# P0-B verification progress

Date: 2026-11-05. Repository base: `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`.

Phase 0 remains open. P1-A has not started. The upgrade follow-up did not change application source or the development and hosted databases. A harness follow-up corrected `tests/browser/test_p0b_acceptance.py` and reran only those Selenium checks. It did not change application behavior, roles, JWT settings, or the hosted schema, and it did not repeat the database evidence below.

## Evidence retained from Grok's run

- Grok's saved `proof-pytest.txt` records all six `tests/test_audit_postgres.py` proofs passing against isolated PostgreSQL 17.11. This follow-up inspected that result; it did not rerun those already-passing proofs.
- Grok reported a cutover-era local application dump restored into `p0b-pg17-restore`: 22 table digests including Alembic, 21 application tables, 15,164 application rows, and 17 sequence values matched the source. Source and restore each reconciled 8 accounts with zero failures. Its comparison and read-only reconciliation scripts remain in the local temporary evidence directory. Those source comparisons were not rerun in this follow-up.
- Grok reported manually reapplied historical grants matching the old source, with application-role reads allowed and role/ledger mutations denied. That verifies the historical grant state, not compatibility of the current grant script with the old schema.

## Restore-to-current upgrade verified in this follow-up

The original restored database is at Alembic `c7e8f1a2b345`. The current grant script expects later schema objects. Running that script before migrations fails at the absent `users.full_name` column. This is an ordering mismatch; the remedy tested here is migrate the restored copy, then apply current grants.

The original restored database was left at its old revision. A new isolated container, `p0b-pg17-upgrade`, was created using the existing local `postgres:17` image, bound only to `127.0.0.1:54332`. A custom-format dump from the existing disposable restore was loaded into its `p0b_upgrade` database with ownership and ACL replay disabled. No dump was taken from the development or hosted database during this follow-up.

| Check | Observed result |
| --- | --- |
| Initial revision of the new copy | `c7e8f1a2b345` |
| `python -m alembic upgrade head` | All seven forward migrations passed; final revision `f3a8c2d7e961` |
| Original application data | All 21 original application tables retained matching counts and digests across their original columns: 15,164 rows. Newly introduced columns are outside this before/after digest comparison |
| Original sequences | All 17 original last values preserved |
| Current `configure_postgres_role.configure` | Passed after migration, using a fresh disposable application password |
| Restricted-role reads | Read all 8 users and representative new evidence, MFA, cash, surveillance, cursor, and scheduler tables |
| Restricted-role privileges | No UPDATE privilege on `users.role`; no UPDATE/DELETE privilege on `ledger_entries`; INSERT/UPDATE privileges present for detector cursors and scheduler locks |
| Ledger reconciliation | The repository's reconciliation function checked 8 accounts, zero failures, without initialization or evidence writes |

Only the new disposable copy was migrated or granted permissions. The upgrade harness set `SCHEDULED_JOBS_ENABLED=false` and did not start an API or background worker. It used a temporary local JWT secret only for process configuration; no enrolled factor was decrypted or changed, and no application JWT secret was rotated.

The assertion-based harness and redacted aggregate result are under ignored `.local-tools/verify_p0b_upgrade.py` and `.local-tools/p0b-upgrade-result.json`. No passwords, connection URLs, database dumps, or account records are included in this document. The new upgrade container is retained for inspection alongside Grok's existing proof, restore, and browser containers.

## Browser acceptance, 2026-11-05

The browser host used by earlier sessions was still unavailable. This pass used Selenium 4.52.0 and the local Chrome 156 in headless mode. The cases live in `tests/browser/test_p0b_acceptance.py` and stay skipped unless `P0B_BROWSER=1`, so the default suite does not launch a browser. The harness follow-up changed only that test.

The mutating journey accepts only `http://127.0.0.1:4173` and `http://127.0.0.1:8000`. Before submitting credentials or an order, it checks both configured database URLs and a live connection: loopback port 54331, database `p0b_browser`, Alembic `f3a8c2d7e961`. It refuses to start when either port is already open, then starts the API with that disposable configuration. Scheduled jobs stayed off. The designated account was `p0b-trader@example.com`, created on that disposable database. The browser window was set to 1280 by 800. The recorded CSS viewport, from `window.innerWidth` and `window.innerHeight`, was 1264 by 649.

| Check | Result |
| --- | --- |
| Signed-out `/` and `/dashboard` | Public dashboard rendered, and the top-right control was the `Log in` link |
| `/market` | Market dashboard rendered while signed out |
| Sign-in and account dashboard | Landed on `/dashboard` with heading "Trading & Risk Overview". Cash `$100,000`. Buying power `$100,000` |
| Paper order | Resting limit buy, symbol `P0B`, quantity 1, limit 100. Status open. Order id 1 |
| Idempotency replay | The page resent the captured request. Status 200 returned order id 1. The book still showed one order. Assertion output contained redacted counts and statuses |
| Balances while open | Cash stayed `$100,000`. Buying power became `$99,900` |
| Cancel | Status became canceled. Cash `$100,000`. Buying power returned to `$100,000` |
| Expired access token | The dashboard stayed open. The harness substituted an expired access token on 3 outgoing requests and revoked the disposable refresh token. The document was not reloaded. The overview and cash disappeared, and the login form was shown. The API log showed 2 non-auth 401 responses and 3 `POST /auth/refresh` 401 responses |
| Missing session | After signing in again, cookies were cleared and a full navigation to `/compliance` landed on `/login` |
| Trader compliance denial | After signing in again, `/compliance` showed "Compliance access is limited to compliance officers, admins, and auditors." The API returned 403 |
| Local bundle | `/assets/index-CihlNHv5.js`, 502446 bytes, SHA256 `3EB2AFB2C281117F64F0403BF233494D452BDFF04292E829023C4ACDA28988B9` |

`pytest -q -s --tb=short tests/browser/test_p0b_acceptance.py` with `P0B_BROWSER=1` reported 2 passed in 25.91 seconds. The second test did not log in. The loopback API and Vite preview started by the harness were stopped after the run.

## Hosted frontend, recorded separately

The hosted service still serves the older web bundle. Selenium opened only the public page and did not submit credentials.

| Item | Value |
| --- | --- |
| URL | `https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com/` |
| Title | getrichyesterday |
| Bundle | `/assets/index-BM-PutKc.js`, 502102 bytes, SHA256 `FF96D89E5CB2BB5C7AF16506F495398B1195036059473E06C988F5201482DB21` |
| Public dashboard label | Absent |
| Authenticated | No |
| Viewport | CSS viewport 1264 by 649, from `window.innerWidth` and `window.innerHeight`. The browser window was set to 1280 by 800 |

## Current hosted schema and ledger

A temporary Lightsail instance, `fintechapp-p0b-reader-20261105`, reached the private database `fintechapp-preview-db` from inside the same region. The session set `default_transaction_read_only` and ran selects only. The live database stayed private. No hosted password, schema, or row was changed.

| Check | Result |
| --- | --- |
| Engine | PostgreSQL 17.11 |
| Alembic revision | `f3a8c2d7e961` |
| Public tables | 40 |
| Accounts | 14: 12 trader, 1 compliance officer, 1 admin |
| Ledger reconciliation | 14 checked, 14 ok, 0 failed, 36 ledger rows |
| Holdings and orders | 2 holding rows. Orders: 1 open, 1 canceled |

No account identifiers, positions, or credentials are published here.

## Hosted snapshot recovery

Source: manual snapshot `fintechapp-preview-data-20261031`, taken from `fintechapp-preview-db` at `2026-10-31T20:10:58-04:00`, engine PostgreSQL 17.11, allocated size 40 GB. Format is a Lightsail relational-database snapshot, not a `pg_dump` file. It was restored only into a new private database, `fintechapp-p0b-snap-20261105`. `fintechapp-preview-db` was not overwritten. The restored database stayed `publiclyAccessible=false`. The current hosted master password did not authenticate to that restored copy, so the disposable database's master password was rotated and the live database password was left unchanged.

The same read-only census, with `default_transaction_read_only`, reported:

| Check | Restored snapshot |
| --- | --- |
| Engine | PostgreSQL 17.11 |
| Alembic revision | `c7e8f1a2b345` |
| Public tables | 22 |
| Accounts | 8: 6 trader, 1 compliance officer, 1 admin |
| Ledger reconciliation | 8 checked, 8 ok, 0 failed, 20 ledger rows |
| Holdings and orders | 2 holding rows. 0 orders |

That matches the cutover-era account and ledger counts. It is an older schema than the live database's `f3a8c2d7e961`. Historical snapshot recovery and the current hosted revision are separate results. No positions or credentials are published.

After the census, `fintechapp-p0b-snap-20261105` and `fintechapp-p0b-reader-20261105` were deleted. `fintechapp-preview-db` remained available and private. The manual snapshot remained available. No Lightsail instances remained in us-east-2.

## Deployment image identity verified after sign-in

On 2026-11-05 the user authorized `aws login --profile fintechapp` and selected high guidance. Sign-in and `sts get-caller-identity` succeeded. The selected profile is in `us-east-2`. The project-plan read returned `FREE`, `ACTIVE`; no plan or billing setting was changed.

Read-only `get-container-services` and `get-container-images` calls confirmed service `fintechapp-preview` is `RUNNING`, with deployment 7 `ACTIVE`:

| Container | Active registered image | Registered digest |
| --- | --- | --- |
| API | `:fintechapp-preview.api.3` | `sha256:8a4808302edca922d9224f69e0325af12ed458852deffbc696c90befa9e7ac13` |
| Web | `:fintechapp-preview.web.4` | `sha256:188016d414b1650fc41b63c4d034e0088a29aa3f19a6f9ac3cc687ab58b73e62` |

The registered images were created on 2026-11-04. These reads establish image identity and its association with the active deployment, not a cryptographic attestation tying the build to a Git commit. The separately recorded hosted bundle remains older than the current local frontend. The later API-image APT patch and public-dashboard change were not deployed by this verification.

The CLI queries selected only image labels, digests, creation times, service state, and deployment version. Deployment environment values were excluded. No instance, database, deployment, image, or permission was created or changed.

## Remaining gates

- The local restore, upgrade, grants, and ledger checks recorded above are the cutover-era copy and its upgrade rehearsal. They are separate from this hosted snapshot restore.
- The browser-harness corrections were reviewed after the recorded rerun. Loopback and database-target guards and access-status parsing passed independent offline checks; Selenium itself was not rerun by that reviewer. P0-B's revised local harness was accepted for the next local implementation review unit.
- Provider source checks and corrected dependency assessments are now recorded in [PROVIDER_ACCESS_REVIEW.md](PROVIDER_ACCESS_REVIEW.md). Actual usage permissions and owner approvals remain open; a source review is not an entitlement approval.
- The initial digest read was blocked by an expired named profile. After authorized sign-in, active image labels and digests were verified above. A source-commit build attestation was not established. AWS MCP tools were not exposed, so the reads used the local AWS CLI without retrieving deployment secrets.
- Phase 0's release/deployment limitations remain open. P1-A is permitted as the next local implementation unit under its reviewed contract; it has not started in this follow-up.

## Rollback note

- The development database on `127.0.0.1:5433` was not migrated, dumped, or granted in this browser and hosted pass. Disposable local containers from the earlier proof, restore, upgrade, and browser databases were left running.
- The local API and Vite preview started for Selenium were stopped after the passing run.
- Hosted application data was not changed. The only hosted mutation was a master-password rotation on the disposable restore `fintechapp-p0b-snap-20261105`. That database and the temporary reader instance were then deleted. The live database password, schema, and rows were not changed, and the manual snapshot was retained.
