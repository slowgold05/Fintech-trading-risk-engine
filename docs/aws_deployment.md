# AWS recruiter demo operations

As verified on 2026-10-31, the public demo is <https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com/>. It uses the AWS-provided HTTPS hostname; no custom domain is configured. All regional resources are in the project's selected Region, `us-east-2`. Confirm that Region in AWS Settings > View all projects > Overview > Additional Info > Region. Check project credit and spend status in AWS Settings > Billing.

## Running resources

| Resource | Name and configuration | Purpose |
| --- | --- | --- |
| Lightsail container service | `fintechapp-preview`, micro power, scale 1 | Runs the web and API containers behind the managed HTTPS endpoint. |
| Lightsail managed database | `fintechapp-preview-db`, PostgreSQL 17, `micro_2_0`, public access off | Holds the migrated app data. The API uses the restricted `fintech_app` login over TLS with `sslmode=verify-full`. |
| Manual database snapshot | `fintechapp-preview-data-20261031` | Post-cutover recovery point. Lightsail also keeps seven days of automatic database backups. |

At the verified sizes, the service is $10/month and the database is $15/month, before any transfer overage. Manual snapshots are billed separately at [$0.05/GB-month](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-databases.html). The service is billed while it exists, including when idle. No temporary migration or setup instance remains.

## Containers and secrets

The repository root `Dockerfile` builds the non-root FastAPI image. It bundles `deploy/us-east-2-bundle.pem` and sets `PGSSLROOTCERT` for verified PostgreSQL TLS. `frontend/Dockerfile.aws` builds the Vite app and serves it through `frontend/nginx.aws.conf` on port 8080. Nginx proxies `/api/` to the API on localhost port 8000. The public endpoint is the web container; its health check calls `/api/health`, which queries PostgreSQL. The frontend build uses `VITE_API_BASE_URL=/api`.

The running API receives `DATABASE_URL` for the restricted role, `JWT_SECRET`, `REFRESH_COOKIE_SECURE=true`, `ENABLE_HSTS=true`, and `ENABLE_API_DOCS=false`. `MIGRATION_DATABASE_URL` and the database master password are used only during private migrations and role setup; they are not in the running API deployment. The secret values are never committed. Lightsail deployment environment values can be read by project administrators, so limit access and avoid printing full deployment responses. The ignored, access-restricted local `.env.aws-preview-secrets.json` holds the current preview credentials for an operator; it is not a shared secret store.

## Build and deploy a code change

1. Run the backend and frontend tests in the [README](../readme.md), then build Linux AMD64 images from the target commit. The current build inputs are the root `Dockerfile` and `frontend/Dockerfile.aws`.
2. Upload each image to the Lightsail container service with the official `lightsailctl` plugin and `aws lightsail push-container-image --region us-east-2 --service-name fintechapp-preview --label <api-or-web> --image <local-image:tag>`. Read the versioned image names from `get-container-images`; do not guess them. The first deployment used a temporary Linux host because Windows Application Control blocked the local plugin executable.
3. If the release includes schema changes, use a **separate temporary Lightsail instance in `us-east-2`** to reach the private database. Restrict its SSH firewall to the operator IP, use temporary SSH credentials and a pinned host key, and copy the target source without secrets. Install its Python dependencies in a virtual environment. Pass the migration URL and required settings to the migration process through encrypted SSH standard input; keep them out of instance user data, command arguments, files on the runner, and Lightsail container deployment history. Run Alembic to the expected head, refresh `configure_postgres_role`, and verify existing row counts, restricted-role grants, and ledger reconciliation. Confirm a usable database recovery point before starting.
4. Create a **complete** deployment specification with both containers, their ports, the normal restricted-role API environment, `RUN_DB_SETUP=false`, and the web `publicEndpoint` on port 8080 with health path `/api/health`. Never include `MIGRATION_DATABASE_URL` or the master password. Enable `SCHEDULED_JOBS_ENABLED` when the operating loop is ready. A new deployment replaces the entire previous specification. Keep the specification in an ignored, access-restricted file and pass it with `--cli-input-json file://...`; never commit or print it.
5. Poll only the new deployment's version and state until it is `ACTIVE`, then test `/`, a client deep link, `/api/health`, and `/api/docs` (expected 404). Verify login, paper trading, cash replay, approvals, and stored scheduler evidence. A failed deployment leaves the prior active version serving. Inspect container logs if activation fails. Delete the temporary runner and its local temporary SSH credentials after verification; stopping an instance does not stop its charges.

Private ECR pulls failed here even though the repository policy matched Lightsail's puller role. A public image activated successfully, and direct uploads into Lightsail worked. The project's managed resource policy is a likely cause of the private ECR failure; it was not proven from a service-side denial log. The two unused ECR repositories were removed. Use [AWS's direct image upload procedure](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-pushing-container-images.html) for the next deployment.

## Database cutover and recovery

The source was the local PostgreSQL 17 database. The public service was disabled to stop writes, a pre-cutover snapshot was taken, and a full custom-format archive was restored on a temporary Lightsail instance with PostgreSQL 17 `pg_restore --single-transaction --clean --if-exists --exit-on-error --no-owner --no-acl`. The schema and data restore completed in one transaction. The operator reapplied grants with `app.scripts.configure_postgres_role`, ran `alembic current` and the combined controls, then re-enabled the service. The empty pre-cutover snapshot and temporary instance were deleted after verification. The source database remains local.

The verification matched every row in 22 tables including `alembic_version`: 21 application tables and 15,164 rows, plus 17 sequence values. Migrated admin and compliance-officer sign-ins returned their expected roles; the authenticated portfolio API and public health check passed. A manual ledger reconciliation checked eight accounts with no failures. The post-cutover snapshot above is available for recovery. To restore from it, create a **new** Lightsail database, verify its endpoint and data, then update the restricted app connection and redeploy; do not overwrite the running database without a separate cutover plan. [Detailed migration notes](postgresql_migration.md) record the checks.

## 2026-11-04 audited release

Application release [PR #12](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/12) is merged. Deployment **7** is active with API `:fintechapp-preview.api.3` and web `:fintechapp-preview.web.4`. It uses `SCHEDULED_JOBS_ENABLED=true`, `RUN_DB_SETUP=false`, and `MFA_REQUIRED=false`; `YENTE_URL` remains empty. Neither the migration URL nor the master password was placed in this deployment.

The separate temporary Ubuntu runner used private database connectivity in `us-east-2`, temporary SSH credentials, and an SSH firewall restricted to the operator's address. Migrations advanced `c7e8f1a2b345` through all seven revisions to `f3a8c2d7e961`, and the restricted-role grants were refreshed. Pre-migration counts covered 21 existing application tables and 15,261 rows. Existing row counts were preserved. Ledger reconciliation passed for 13 accounts before rollout and all 14 after the dedicated smoke-test account was registered. No role-edit privilege was granted to the application login.

Live HTTP checks passed home and deep links, database health, disabled API docs, existing admin and compliance-officer login, all compliance read endpoints, and a recorded propose-only intent approval. A dedicated paper trader posted a $1 deposit and $1 screened withdrawal with successful replays and ended at its original cash balance. An NVDA limit order was placed, replayed, and canceled without executing a fill. The trader was denied access to the compliance API. The smoke account and its audit records remain in the demo; its generated credentials are in ignored, access-restricted `.env.release-smoke-trader`.

The scheduler refreshed 180 quotes and inserted evidence for 23 application controls. The exported payload hashes verified, the scheduler lease was released, and `next_due` was stored for `2026-11-05T22:17:33.000666` UTC. The first scheduled status snapshot was 10 pass, 12 `no_sample`, one fail (SM-AC-04, incomplete optional MFA enrollment), and five `not_run` controls outside the scheduled runner. These are operating results, not a claim that every control passed. The new smoke account also needs a quarterly access-review decision. No AML or surveillance rule was activated.

The temporary runner was deleted after verification, along with temporary local SSH credentials and the unused migration-startup specification. The existing application service, private database, and recovery snapshot were retained. All 134 backend tests, including the PostgreSQL race and grant proofs, passed locally; frontend lint, 9 tests, and build passed. All six release CI gates passed. Browser click-through was not possible because the browser/computer-use service was unavailable; the live checks above used HTTP clients.

## Earlier operating checks

| Check | Last verified result |
| --- | --- |
| Public home, `/portfolio`, `/api/health` | HTTP 200 after cutover. |
| `/api/docs` | HTTP 404 by configuration. |
| Market overview | Four index trends, 11 sectors, no cache gaps after a one-time refresh of 50 hot quotes to 2026-10-30 data. |
| Hosted operator control run | App-role grants, role audit, ledger, and market freshness passed. Trading-halt, price-band, and idempotency controls reported `no_sample`. |
| Live compliance console | All controls show `not_run` until the API image that reads `control_evidence` is deployed. |
| 2026-11-03 operating samples | Halt then resume left trading open. Q4 access review retained every other account. Open NVDA order 1 is a one-share buy at $184.18, and the idempotent retry left that single order. Create calls still returned HTTP 500 on this image. |
| Quote cache on 2026-11-03 | 68 quotes were cached from 2026-10-28 or 2026-10-30. 496 quotes were still dated 2026-07-02 and stale. |
| CI | Six checks passed on the migration documentation commit in [draft PR #1](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/1). |

The current deployment procedure uses the private runner described above, replacing the earlier suggestion to put migration credentials in an API startup deployment. The API operating loop refreshes quotes, reconciles the ledger, and writes append-only `control_evidence` when `SCHEDULED_JOBS_ENABLED=true`. Cached prices can still become stale when an upstream request fails or a symbol is outside the refresh limits; stock orders stop after the seven-day reference-price limit. The 2026-10-31 evidence files remain under ignored `grc/evidence/aws-preview-20261031*` on the development machine. An evidence copy outside the database, broad MFA enrollment and recovery, shared rate-limit storage, and independently approved policies remain open in the [GRC action items](GRC_ACTION_ITEMS.md). The micro container service has fixed capacity and does not autoscale; monitor it before inviting substantial traffic.

To stop the container-service charge, delete `fintechapp-preview` in the Lightsail console or run `aws lightsail delete-container-service --service-name fintechapp-preview --region us-east-2`. The database and manual snapshot have separate charges and must be reviewed separately before deletion. Deleting the database also deletes its automatic backups; retain a verified snapshot first.
