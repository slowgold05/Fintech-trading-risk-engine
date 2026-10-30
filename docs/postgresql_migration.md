# MySQL to PostgreSQL migration

The local development database was copied on 2026-10-30 from MySQL to a PostgreSQL 17 container named `fintechapp-postgres`, using the persistent Docker volume `fintechapp_pgdata` and loopback port 5433. The MySQL database and ignored `.env.mysql-backup` remain available for rollback. The app uses a restricted PostgreSQL login; Alembic and privileged role changes use a separate migration login.

## Repeat on another environment

1. Stop API writes and back up the MySQL database and its `.env` file. Provision an empty PostgreSQL database and a migration login. Keep credentials in environment variables or an ignored secret file.
2. Install `requirements.txt`. Set `DATABASE_URL` and `MIGRATION_DATABASE_URL` to the PostgreSQL migration URL, then run `python -m alembic upgrade head`.
3. Set `SOURCE_DATABASE_URL` to the MySQL app URL and `TARGET_DATABASE_URL` to the PostgreSQL migration URL. Run `python -m app.scripts.migrate_mysql_to_postgres`. The target must contain only the Alembic schema, with no application rows. The copy runs in one target transaction, verifies every table's count and data digest, and resets PostgreSQL sequences. It refuses source data containing request-linked role changes until that cyclic foreign key is made deferrable.
4. Set `MIGRATION_DATABASE_URL` to the PostgreSQL migration URL and `POSTGRES_APP_PASSWORD` to a fresh password. Run `python -m app.scripts.configure_postgres_role`. Set `DATABASE_URL` to the resulting `fintech_app` PostgreSQL URL.
5. Run `python -m app.scripts.run_controls`, verify API login and trading with the app role, then reopen writes on PostgreSQL. Keep the MySQL source read-only until retention and rollback needs are reviewed. Process environment variables override `.env` values; clear old MySQL `DATABASE_URL` overrides before launching the API.

For a Railway API service, use the repository Dockerfile and set `DATABASE_URL` to the restricted app URL and `MIGRATION_DATABASE_URL` to the migration URL. After the one-time copy and role setup, configure `python -m alembic upgrade head` as the service's pre-deploy command and set a healthcheck on `/`. The image listens on Railway's `PORT` or local port 8000. Keep the migration URL out of the public frontend service.

## Local verification

The migration copied 15,163 rows in 19 application tables, including 8 users, 12 trades, 20 ledger postings, and 13,016 market symbols. All per-table data digests matched. PostgreSQL ledger reconciliation checked 8 accounts with zero failures. The app-role grant, role-audit, ledger, and market-data controls passed; price-band and idempotency controls reported `no_sample` because the local database has no orders or request records. A rollback-only app-role write created a user and opening ledger entry, then rolled both back.

The local Windows task `SentinelMarketsLedgerReconciliation` is scheduled daily at 02:00. Its manual verification run returned status 0. It requires the current user to be signed in; hosted reconciliation still needs a deployment scheduler.

Audit evidence is under ignored `grc/evidence/` and should be archived outside this host. The PostgreSQL container and volume are local development infrastructure; hosted environments need their own database provisioning, least-privilege grants, backups, and cutover checks.
