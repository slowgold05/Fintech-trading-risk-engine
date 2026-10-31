# MySQL to PostgreSQL migration

The local development database was copied on 2026-10-30 from MySQL to a PostgreSQL 17 container named `fintechapp-postgres`, using the persistent Docker volume `fintechapp_pgdata` and loopback port 5433. The MySQL database and ignored `.env.mysql-backup` remain available for rollback. The app uses a restricted PostgreSQL login; Alembic and privileged role changes use a separate migration login.

## Repeat on another environment

1. Stop API writes and back up the MySQL database and its `.env` file. Provision an empty PostgreSQL database and a migration login. Keep credentials in environment variables or an ignored secret file.
2. Install `requirements.txt`. Set `DATABASE_URL` and `MIGRATION_DATABASE_URL` to the PostgreSQL migration URL, then run `python -m alembic upgrade head`.
3. Set `SOURCE_DATABASE_URL` to the MySQL app URL and `TARGET_DATABASE_URL` to the PostgreSQL migration URL. Run `python -m app.scripts.migrate_mysql_to_postgres`. The target must contain only the Alembic schema, with no application rows. The copy runs in one target transaction, verifies every table's count and data digest, and resets PostgreSQL sequences. It refuses source data containing request-linked role changes until that cyclic foreign key is made deferrable.
4. Set `MIGRATION_DATABASE_URL` to the PostgreSQL migration URL and `POSTGRES_APP_PASSWORD` to a fresh password. Run `python -m app.scripts.configure_postgres_role`. Set `DATABASE_URL` to the resulting `fintech_app` PostgreSQL URL.
5. Run `python -m app.scripts.run_controls`, verify API login and trading with the app role, then reopen writes on PostgreSQL. Keep the MySQL source read-only until retention and rollback needs are reviewed. Process environment variables override `.env` values; clear old MySQL `DATABASE_URL` overrides before launching the API.

For a hosted API service, use the repository Dockerfile and set `DATABASE_URL` to the restricted app URL. Run `python -m alembic upgrade head` with `MIGRATION_DATABASE_URL` through a private setup host before each schema-changing API deployment, then refresh the app-role grants. Keep the migration URL out of the running API and frontend. Check `/health`, which verifies database connectivity. The image listens on `PORT` or local port 8000.

## AWS preview

An AWS Lightsail PostgreSQL 17 database named `fintechapp-preview-db` was provisioned in the selected Region `us-east-2`. Its public access is off. The schema is at Alembic head `c7e8f1a2b345`; a separate `fintech_app` role has scoped grants. The hosted database has no copied application rows. The local 15,163-row database remains the source pending an owner decision on whether the preview should contain historical users and trades. Do not run the MySQL-to-PostgreSQL copy against this already migrated target.

The matching Lightsail container service `fintechapp-preview` runs the API and web containers. The API uses `sslmode=verify-full` with the bundled AWS CA certificate, and the web container proxies `/api/` to the API on localhost. The deployment uses an AWS-provided HTTPS address. Images are uploaded directly into Lightsail with `aws lightsail push-container-image`: this project's managed resource policy appears to block the Lightsail puller role from reading private ECR, even with the documented repository policy. Runtime credentials are held in ignored, access-restricted local files; never commit or paste them into tickets or command output. Lightsail deployment environment settings remain visible to project administrators, so this is a preview, not a production secret-management design.

The preview is live at <https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com/>. On 2026-10-31 the HTTPS home page and `/portfolio` returned 200, `/api/health` returned `{"status":"ok"}`, and `/api/docs` returned 404. The temporary setup instance and its SSH key pair were deleted after deployment. The unused ECR repositories were also deleted.

The database is $15/month and the container service is $10/month at the selected sizes. These resources consume the project's credits or incur charges according to its plan and usage. Keep the application data decision separate from infrastructure verification. The preview does not yet run the hosted reconciliation schedule or market-data refresh jobs, and control evidence still needs independent retention and review.

## Local verification

The migration copied 15,163 rows in 19 application tables, including 8 users, 12 trades, 20 ledger postings, and 13,016 market symbols. All per-table data digests matched. PostgreSQL ledger reconciliation checked 8 accounts with zero failures. The app-role grant, role-audit, ledger, and market-data controls passed; price-band and idempotency controls reported `no_sample` because the local database has no orders or request records. A rollback-only app-role write created a user and opening ledger entry, then rolled both back.

The local Windows task `SentinelMarketsLedgerReconciliation` is scheduled daily at 02:00. Its manual verification run returned status 0. It requires the current user to be signed in; hosted reconciliation still needs a deployment scheduler.

Audit evidence is under ignored `grc/evidence/` and should be archived outside this host. The PostgreSQL container and volume are local development infrastructure; hosted environments need their own database provisioning, least-privilege grants, backups, and cutover checks.
