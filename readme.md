# Sentinel Markets

Every movement of money is explainable, every control is tested, and nothing changes without leaving proof.

[Control matrix](grc/control_matrix.csv) · [Control workpapers](grc/workpapers) · [Threat model](docs/THREAT_MODEL.md) · [Roadmap](Finance%20Project%20Roadmap%20Built%20for%20GRC.md)

This repository contains a FastAPI backend and a React/Vite frontend for a
mock brokerage and its risk and control evidence.

The [CI workflow](.github/workflows/ci.yml) runs backend and frontend checks plus
Gitleaks, Bandit, pip-audit, Semgrep, and Trivy on each push. Their check results appear on pull requests.
Main branch protection requires pull requests and all six jobs. Approving reviews remain optional until a second collaborator is available.

For a local staged-secret check, install Gitleaks and run `git config --local core.hooksPath .githooks`. The pre-commit hook blocks commits when Gitleaks is missing or finds a leak. This Windows checkout also supports an ignored `.local-tools/gitleaks.exe` binary.

## Project Layout

```text
app/                 FastAPI application package
alembic/             Database migrations
frontend/            React + Vite + TypeScript frontend
docs/                Architecture, security, and frontend handoff notes
requirements.txt     Backend Python dependencies
alembic.ini          Alembic configuration
.env                 Local backend environment variables
.env.example         Backend environment template
```

Generated frontend output and dependencies live under `frontend/dist/` and
`frontend/node_modules/`.

## Backend

Install dependencies from the repository root:

```powershell
python -m pip install -r requirements.txt
```

For an isolated non-root API and fresh PostgreSQL database, see [Docker Compose setup](docs/container_setup.md).

Configure `.env` with PostgreSQL (see [migration steps](docs/postgresql_migration.md) when moving an existing MySQL database):

```env
DATABASE_URL=postgresql+psycopg://fintech_app:YOUR_APP_PASSWORD@localhost:5433/fintechapp
MIGRATION_DATABASE_URL=postgresql+psycopg://fintech_migrate:YOUR_MIGRATION_PASSWORD@localhost:5433/fintechapp
JWT_SECRET=replace_with_a_long_random_secret
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXP_MINUTES=30
CORS_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173"]
```

Apply migrations:

```powershell
python -m alembic upgrade head
```

The API login needs read/write grants on ordinary tables and only `SELECT`/`INSERT`
on `ledger_entries`; the separate migration login creates schema changes. For
role separation, give the app login `SELECT` on `role_changes` and restrict its
`users` privileges to `SELECT`, `INSERT (email, password_hash, cash_balance)`,
and `UPDATE (cash_balance)`. The local `fintech_app` login has these grants.

Start the API:

```powershell
python -m uvicorn app.main:app --reload
```

Backend docs are available at:

```text
http://127.0.0.1:8000/docs
```

Use `POST /auth/register` to create an app user, then log in through the
frontend with that email and password.

## Compliance access

New accounts are `trader` by database default. Seed the first admin and compliance officer after registering those accounts:

```powershell
python -m app.scripts.set_user_role --bootstrap --email admin@example.com --role admin --reason "Initial administrator"
python -m app.scripts.set_user_role --bootstrap --email reviewer@example.com --role compliance_officer --reason "Initial compliance reviewer"
```

After bootstrap, an admin requests a role change in `/compliance`, a different compliance officer approves it, and a privileged operator applies the approved request:

```powershell
python -m app.scripts.set_user_role --request-id 1
```

The command requires `MIGRATION_DATABASE_URL`. A database trigger records every `users.role` update in `role_changes`, including a direct privileged update; the command passes the approved request ID, operator, and reason to that trigger and verifies its audit row before commit. The app login cannot update user roles or write role-change records. Role-change records also have database triggers that reject updates and deletes. Compliance officers, admins, and auditors can open `/compliance` and read the latest control statuses and access changes. Trader-only endpoints reject these roles. Bootstrap is limited to the first account in each role.

The compliance page also lists every account for the current UTC quarter. Admins and compliance officers can record a retain or remove decision with a reason, except on their own account. Auditors can inspect reviews but cannot submit them. A changed role becomes unreviewed again. Remove decisions flag remediation; they do not change the role automatically.

The same compliance view reads `grc/risk_register.yaml` and shows inherent and residual ratings for five initial risks. Residual rating drops one level only when every linked control has passing evidence from the last 36 hours. Failed, missing, stale, or no-sample evidence leaves the inherent rating in place; this provisional scoring method needs policy-owner review before operational use.

Run `python -m app.scripts.configure_postgres_role` with `MIGRATION_DATABASE_URL` and `POSTGRES_APP_PASSWORD` after migrations. It grants the app role the table and column permissions it needs and keeps ledger updates, role changes, and access-review edits out of that role. Re-run it after future schema migrations. Protect the migration login as an operator credential because it can alter the triggers and audit rows.

## Frontend

Install dependencies and run from `frontend/`:

```powershell
cd frontend
npm install
npm run dev
```

The frontend runs at:

```text
http://127.0.0.1:5173
```

The frontend API client defaults to:

```text
http://127.0.0.1:8000
```

Override it with `frontend/.env` when needed:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Connection Points

- Login posts form-encoded credentials to `POST /token`.
- Protected requests send `Authorization: Bearer <token>`.
- Frontend API modules live in `frontend/src/api/`.
- Backend routers live in `app/routers/`.
- Main authenticated backend routes are `/trades/`, `/portfolio/`, and `/risk/`.

## Order book

`POST /orders/` and `POST /trades/` require an `Idempotency-Key` header (8–128 letters, digits, `_`, or `-`). Retry the same request with the same key to get its original response without placing another execution. Reusing the key for a different request returns `409`. Keys are scoped to each user and shared across both endpoints. `POST /orders/` accepts a stock `symbol`, `side`, `quantity`, `order_type` (`limit` or `market`), and `limit_price` for limit orders. Limit orders rest in the book until filled or canceled; market orders fill against available resting orders and cancel any remainder. The execution price is the resting order's price. The API rejects orders that exceed available cash or shares, including amounts reserved by open orders. It does not match a user's own orders.

Use `GET /orders/book/{symbol}` for open bids and asks, `GET /orders/` for your orders, and `POST /orders/{id}/cancel` to release a remaining reservation. Direct `POST /trades/` still uses the quote provider; it also respects open order reservations. Portfolio reset requires all open orders to be canceled first.

Example limit order:

```json
{"symbol":"AAPL","side":"buy","order_type":"limit","quantity":1.5,"limit_price":100.25}
```

Example market order:

```json
{"symbol":"AAPL","side":"sell","order_type":"market","quantity":1}
```

Run all six app-role, role-audit, ledger, market-data, price-band, and idempotency controls with `python -m app.scripts.run_controls`. This requires both `DATABASE_URL` and `MIGRATION_DATABASE_URL`; the role-audit probe uses the privileged login and rolls back its test update. Each control writes a timestamped JSON evidence file in `grc/evidence/`; the command exits nonzero when a control fails. Price-band and idempotency controls report `no_sample` when they have no live records to check.

After a branch push CI run completes, run `python -m app.scripts.check_repository_controls --repo slowgold05/Fintech-trading-risk-engine --branch <branch>` from that branch. It verifies main protection and the latest run for the checked-out commit, then records SM-CM-01 and SM-SM-01 evidence. It requires an authenticated GitHub CLI.

Set `TRADING_HALTED=true` and restart the API to stop new order placement and direct trades. Existing orders can still be canceled. This is a process-level kill switch; an audited operator control is still planned.

Stock orders require a cached reference quote no older than seven calendar days. Limit prices and execution prices must stay within 20% of that quote; otherwise order entry or matching fails with control ID `SM-PT-02`. The control runner checks open orders against the latest quote and writes evidence for this check.

New stock buys also have a 50% per-symbol exposure cap (`MAX_STOCK_CONCENTRATION_PCT`). It counts held shares and open buys, and uses the higher of the limit and reference prices for pending exposure. Other holdings use their latest usable cached quote, or book cost where no usable quote exists; that fallback is a known limit for the demo.
