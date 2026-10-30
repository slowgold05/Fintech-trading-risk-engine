# Local API container setup

The Compose stack starts a non-root FastAPI image and a fresh PostgreSQL 17 database. It uses separate `fintechapp_compose_pgdata` and `fintechapp_compose_evidence` volumes; it does not use or alter the migrated local PostgreSQL volume `fintechapp_pgdata`.

Copy `.env.compose.example` to ignored `.env.compose` and replace all three placeholders with independent random values. Then run:

```powershell
docker compose --env-file .env.compose up --build -d
```

The API is at `http://127.0.0.1:8000/`. Its startup applies Alembic migrations and the restricted PostgreSQL app-role grants before serving requests. The frontend can run locally on port 5173. To stop the stack while keeping its database and evidence volumes:

```powershell
docker compose --env-file .env.compose down
```

The API image runs as UID 10001 and copies only the app, migrations, control definitions, and risk register. `.env` files and local evidence are excluded from the image. CI builds the API image and scans it with Trivy in addition to scanning frontend dependencies. A local full image scan on 2026-10-30 found 44 high or critical Debian findings with no upstream fixed versions; the CI image gate blocks fixable high or critical findings and the base image should be rechecked as fixes become available. This Compose database is a clean development instance; use the [migration procedure](postgresql_migration.md) to move existing data into a separate target.
