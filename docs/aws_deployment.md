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
3. Create a **complete** deployment specification with both containers, their ports, the API environment above, and the web `publicEndpoint` on port 8080 with health path `/api/health`. A new deployment replaces the entire previous specification. Keep the specification in an ignored, access-restricted file and pass it with `--cli-input-json file://...`; never commit or print it.
4. Poll only the new deployment's version and state until it is `ACTIVE`, then test `/`, a client deep link, `/api/health`, and `/api/docs` (expected 404). A failed deployment leaves the prior active version serving. Inspect container logs if activation fails.

Private ECR pulls failed here even though the repository policy matched Lightsail's puller role. A public image activated successfully, and direct uploads into Lightsail worked. The project's managed resource policy is a likely cause of the private ECR failure; it was not proven from a service-side denial log. The two unused ECR repositories were removed. Use [AWS's direct image upload procedure](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-pushing-container-images.html) for the next deployment.

## Database cutover and recovery

The source was the local PostgreSQL 17 database. The public service was disabled to stop writes, a pre-cutover snapshot was taken, and a full custom-format archive was restored on a temporary Lightsail instance with PostgreSQL 17 `pg_restore --single-transaction --clean --if-exists --exit-on-error --no-owner --no-acl`. The schema and data restore completed in one transaction. The operator reapplied grants with `app.scripts.configure_postgres_role`, ran `alembic current` and the combined controls, then re-enabled the service. The empty pre-cutover snapshot and temporary instance were deleted after verification. The source database remains local.

The verification matched every row in 22 tables including `alembic_version`: 21 application tables and 15,164 rows, plus 17 sequence values. Migrated admin and compliance-officer sign-ins returned their expected roles; the authenticated portfolio API and public health check passed. A manual ledger reconciliation checked eight accounts with no failures. The post-cutover snapshot above is available for recovery. To restore from it, create a **new** Lightsail database, verify its endpoint and data, then update the restricted app connection and redeploy; do not overwrite the running database without a separate cutover plan. [Detailed migration notes](postgresql_migration.md) record the checks.

## Operating checks and open work

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

The API image can refresh quotes, reconcile the ledger, and write append-only `control_evidence` when `SCHEDULED_JOBS_ENABLED=true`. The active deployment does not have that image yet. Deploy with `RUN_DB_SETUP=true` and `MIGRATION_DATABASE_URL` once so Alembic `1c4e8a7b2d90` and `configure_postgres_role` run, then redeploy without the migration URL and with the scheduler enabled. Cached prices can become stale, and stock orders stop after the seven-day reference-price limit, until that schedule is actually running. On 2026-11-03 that was already true for 496 symbols dated 2026-07-02. The image also needs the rate-limit `response` parameter fix: without it, a successful registration or order is saved and the client still receives HTTP 500. The 2026-10-31 evidence files remain under ignored `grc/evidence/aws-preview-20261031*` on the development machine. An evidence copy outside the database, MFA, shared rate-limit storage, and independently approved policies remain open in the [GRC action items](GRC_ACTION_ITEMS.md). The micro container service has fixed capacity and does not autoscale; monitor it before inviting substantial traffic.

To stop the container-service charge, delete `fintechapp-preview` in the Lightsail console or run `aws lightsail delete-container-service --service-name fintechapp-preview --region us-east-2`. The database and manual snapshot have separate charges and must be reviewed separately before deletion. Deleting the database also deletes its automatic backups; retain a verified snapshot first.
