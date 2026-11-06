# Sentinel Markets 2.0 product baseline

Evidence record for Phase 0 task P0-A. This file classifies the product at one commit. It does not mark Phase 0 complete, and it does not change application behavior.

| Field | Value |
| --- | --- |
| Date | 2026-11-05 |
| Branch | `main`, even with `origin/main` |
| Commit | `be8ffdc19f78d2942b5e9922ce605d6a5de7d472` |
| Commit subject | Merge pull request #15 from slowgold05/fix/public-dashboard-entry |
| Local test interpreter | Python 3.11, temporary virtual environment, SQLite in-memory fixtures |
| Hosted read-only target | `https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com` |
| Roadmap | [Sentinel_Markets_2_0_Roadmap.md](../Sentinel_Markets_2_0_Roadmap.md) |
| Written in | `C:\Users\sbhav\.grok\worktrees\fintechapp\frontend-changes` |
| Copied for review to | `E:\fintechapp` |

The review checkout is `E:\fintechapp`. It is the only registered worktree. These four documents were written in the Grok checkout above and copied into `E:\fintechapp\docs\` without changing any other file.

## Scope and delivery order

Sentinel Markets is a paper brokerage. Registration starts an account at `$100,000` simulated cash (`app/models/user.py`). The order book, the immediate fill path, cash movements, and the ledger move that simulated balance. There is no live broker connection in the routers inspected for this baseline.

The 2.0 delivery order is:

1. Phases 0 through 4: baseline, market-data foundation, trader shell, trading terminal, and portfolio intelligence.
2. The core release gate in Phase 7 for that trading product.
3. Phase 5 Research Desk, gated on its own.
4. Phase 6 Forecast Lab, gated on its own.

Research and forecasting stay out of the core release until those later gates pass. Stop orders, intraday feeds, and Strategy Lab stay outside the core release.

## How a status was assigned

| Status | Meaning in this file |
| --- | --- |
| Verified deployed | A read-only hosted response on 2026-11-05 showed it. |
| Implemented locally | The behavior is in this commit. Local tests or direct code inspection support it. The running image was not proven to be this commit. |
| Partial | A piece of the capability exists, and a named gap remains. |
| Documented only | A repository note describes it. This task did not re-execute that check. |
| Proposed | The 2.0 roadmap describes it, and this commit has no matching route or runtime. |

Repository observations and hosted observations are separate rows when they differ. Historical notes in [docs/GRC_ACTION_ITEMS.md](GRC_ACTION_ITEMS.md), [readme.md](../readme.md), and [docs/aws_deployment.md](aws_deployment.md) are leads. The newest hosted-release note is 2026-11-04 deployment 7. Older sections in the same action-item file still describe earlier schema versions. Those older sections are not the current deployment claim.

## Repository versus the hosted service

| Observation | Where it holds | Confidence |
| --- | --- | --- |
| `GET /api/health` returned `{"status":"ok"}` through nginx. `GET /api/docs` returned 404. | Hosted, 2026-11-05 | High for that moment |
| `GET /api/market/overview` returned 4 index trends, 11 sectors, 0 errors, `as_of` `2026-11-04T00:00:00+00:00`. | Hosted read of the quote cache | High for that response |
| `GET /api/market/universe?limit=1` returned `total` 12924. The sample row was symbol `A`, exchange `NYSE`, tier `daily`. | Hosted symbol table | High for the count |
| `GET /api/market/heatmap?limit=1000` joined 564 active, non-test, non-ETF symbols that already have a cache row. Status counts were delayed 105, cached 5, stale 454, live-ish 0. The response listed 234 items after the sector filter dropped the rest. Every returned item source was `yahoo`. Latest `as_of` was `2026-11-04T00:00:00+00:00`. The notice says quotes are delayed or cached and are not suitable for order execution. | Hosted quote cache | High for that response. It is a point-in-time cache census, not a history backfill |
| Hosted web bundle `/assets/index-BM-PutKc.js` contains `Market Research Console` and `Sign in`. It contains none of `Market dashboard`, `Public dashboard`, or `Log in`. | Hosted static asset | High. PR #15 is not in that bundle |
| Local production build `frontend/dist/assets/index-CihlNHv5.js` from this commit contains `Market dashboard` (2), `Public dashboard` (1), and `Log in` (1), and does not contain `Market Research Console`. | This commit, local `npm run build` | High |
| Deployment 7 is documented as API `:fintechapp-preview.api.3` and web `:fintechapp-preview.web.4`, schema `f3a8c2d7e961`. | [docs/aws_deployment.md](aws_deployment.md) 2026-11-04 section | Documented only. This task did not call Lightsail or read image digests |
| Commit `6efec7c` changes the API image after that deployment note. PR #15 changes the web app after it. | `git log` | High that HEAD is newer than the written deployment record |

No hosted login, order, cash movement, migration, or account export was performed.

## Capability classifications

| Capability | Status | Evidence | Limitation | Confidence |
| --- | --- | --- | --- | --- |
| Paper cash, default `$100,000` | Implemented locally | `User.cash_balance` default and `ensure_opening` in `app/services/ledger_service.py` | Hosted balances were not read | High for code |
| Password sessions, refresh cookie, logout | Implemented locally | `app/routers/auth.py`, `tests/test_auth.py` | Hosted login was not repeated | High for local tests |
| Five roles: trader, analyst, compliance_officer, admin, auditor | Implemented locally | Check constraint in `app/models/user.py` | Role grants on the hosted database were not re-probed | High for the model |
| Optional authenticator and login-risk step-up | Implemented locally | `app/routers/auth.py`, `tests/test_phase4_identity.py` | `MFA_REQUIRED=false` is a deployment note, not re-read from the live environment | High for code |
| Market and limit order book, reservations, idempotency, cancel | Implemented locally | `app/routers/orders.py`, `app/services/order_book.py`, `tests/test_orders.py` | Matching uses resting limit prices. A market buy reserves against visible opposite liquidity and can end unfilled. Hosted order placement was not repeated | High for local tests |
| Immediate `POST /trades/` fill | Implemented locally | `app/routers/trades.py` calls `get_live_price` | This path is separate from the order book and calls Alpha Vantage when the key is set. Tests patch the price function | High |
| FIFO lots, realized P&L, hash-chained ledger | Implemented locally | `tests/test_trades.py`, `tests/test_ledger.py` | Hosted reconciliation was not re-run | High for SQLite tests |
| Pre-trade halt, 20% quote band, concentration and position caps | Implemented locally | `app/services/pretrade_controls.py`, `tests/test_orders.py` | The band reads `market_quote_cache`, not the portfolio price function | High |
| Public market overview, universe, and heatmap | Verified deployed for the read endpoints above | Hosted GETs on 2026-11-05 match the response shape in `app/routers/market.py` and `get_cached_heatmap` | Heatmap coverage is 564 cached non-ETF symbols out of 12924 active symbols. 454 of those cache rows were stale | High for the reads |
| `GET /market/trending` and `GET /market/research/{symbol}` | Implemented locally | `app/routers/market.py` calls Alpha Vantage, and research also calls SEC | Not called on the host in this task, because those handlers can call providers | High for code, unverified hosted |
| Quote scheduler | Partial | `app/services/scheduled_jobs.py` refreshes stale hot and daily symbols from Yahoo when `SCHEDULED_JOBS_ENABLED` is on. The 2026-11-04 note says the first hosted cycle refreshed 180 quotes | This task did not read the scheduler lease. The live cache still has 454 stale rows. A refresh count is not a full universe | Medium |
| Daily OHLCV history | Partial | `price_history_daily` stores one Yahoo bar per symbol and date. The writer keeps only the latest complete bar from a 5-day Yahoo chart request | No two-year series, no interval column, no adjustment field, no `fetched_at`, and no quality gate on write. See [API_INVENTORY.md](API_INVENTORY.md) | High |
| Portfolio valuation | Partial | `GET /portfolio/` calls `get_live_price` once per holding. A stock then checks a 30-second price cache and a 300-second quote cache before Alpha Vantage | One missing price fails the whole response. Holdings do not share one database snapshot. A repeated call is not the same thing as a repeated provider request. Details are in the API inventory | High for code |
| Signed-in daily P&L label | Partial | `getDayPnl` returns `summary.total_pnl`. The dashboard labels that fallback "Day P&L", "Day change", and "daily change" | The five-point chart is interpolated. The card chip says "Real 1D". Bulk pricing does not correct either display | High for code |
| `GET /portfolio/pnl`, performance series, trade-impact, scenarios | Proposed | The React client calls `/portfolio/pnl`. No such route is registered. Roadmap routes for performance, allocation, attribution, risk metrics, trade impact, and scenarios are absent | The dashboard draws an interpolated chart when that call fails | High |
| Post-trade risk list | Implemented locally | `GET /risk/` returns stored assessments for the caller. `tests/test_risk.py` | It is not a portfolio VaR or stress model | High |
| Compliance, surveillance, and AML workflows | Implemented locally | `app/routers/compliance.py` and the phase tests | Hosted console was not opened. Rules stay inactive until a second reviewer activates them; that activation state was not re-read | High for code |
| Eight signal identities | Partial | `grc/signals/accounts.yaml` plus `review_account`. All eight fail review. They are not `users` rows | No feed is fetched. See the API inventory | High |
| Research Desk and TradingAgents | Proposed | Phase 5 of the roadmap | No research job routes | High |
| Kronos Forecast Lab | Proposed | Phase 6 of the roadmap. `app/services/forecast.py` is a separate historical-volatility helper and is not Kronos | The helper must not be described as the Forecast Lab | High |
| Watchlists, Lightweight Charts, intraday bars | Proposed | Phases 2 and 3 | No watchlist routes and no chart library dependency in `frontend/package.json` | High |
| Public dashboard entry on `/` and `/dashboard` | Implemented locally. The hosted bundle is the previous public research console | `frontend/src/App.tsx`, `frontend/src/App.test.tsx`, local build strings, hosted bundle strings | Browser acceptance was not run. See [FRONTEND_AUDIT.md](FRONTEND_AUDIT.md) | High for the bundle difference |
| Backup, restore, and rollback | Documented only | [docs/aws_deployment.md](aws_deployment.md) describes snapshot `fintechapp-preview-data-20261031`, seven-day automatic backups, and a new-database restore | This task did not restore a database or list snapshots | Low for current recoverability |
| Account preservation after PostgreSQL migration | Documented only | The 2026-11-04 note records preserved row counts and ledger reconciliation for 14 accounts | This task did not query account tables | Low for current rows |
| PostgreSQL race and grant proofs | Documented only for the 2026-11-04 run. Skipped in this run | `tests/test_audit_postgres.py` | `AUDIT_DATABASE_URL` was unset. Docker was not running. No local PostgreSQL service was found. A new database on a shared server is not an acceptable rerun: `configure_postgres_role` changes the cluster-wide `fintech_app` password | The skip is certain. The historical pass was not repeated |

## Verification recorded with this baseline

Commands were run on 2026-11-05 in this worktree. The test interpreter was Python 3.11 because `py -0p` showed 3.14 and 3.11, and the README names 3.12, which is not installed here. Dependencies were installed into a temporary virtual environment outside the repository. `AUDIT_DATABASE_URL` was unset.

```text
python -m pytest -q -rs --tb=line
128 passed, 6 skipped, 100 warnings in 40.56s
```

The six skips are the disposable PostgreSQL proofs in `tests/test_audit_postgres.py`, each with reason `AUDIT_DATABASE_URL is not set`:

- `test_migrations_and_app_role_grants_on_disposable_postgres`
- `test_app_role_can_write_runtime_records_without_inserting_review_fields`
- `test_two_deposits_both_count_and_two_withdrawals_cannot_spend_the_same_cash`
- `test_one_authenticator_code_and_one_login_challenge_succeed`
- `test_concurrent_aml_scans_wait_on_the_cursor_and_one_cash_scan_opens_the_case`
- `test_concurrent_surveillance_scans_wait_on_the_cursor_and_open_one_case`

Concurrency, grant, and cash-lock claims stay open for this task. The SQLite suite does not replace those proofs. Warnings about Pydantic `class Config`, Starlette `TestClient`, and an unresolvable SQLite drop cycle were already produced by this commit's tests. This task changed no test.

```text
cd frontend
npm ci
npm run lint
npm test
npm run build
```

`npm ci` added 352 packages. ESLint exited 0. Vitest 4.1.12 reported 7 files and 19 tests passed. `tsc -b && vite build` exited 0 and wrote `dist/assets/index-CihlNHv5.js`. Vite warned that the chunk is larger than 500 kB. `npm ci` also printed 7 moderate severity vulnerabilities. `npm audit fix` was not run.

The README's 2026-11-04 counts were 134 passing backend tests with no skips, and 9 frontend tests. This run collected the same 134 backend tests and skipped the 6 PostgreSQL proofs, so the pass count is 128. The frontend suite at this commit is 19 tests. `frontend/src/App.test.tsx` alone has 9. Those counts are results for this SHA, not a claim that deployment 7 had 19 frontend tests.

Hosted checks were unauthenticated GETs of `/api/health`, `/api/docs`, `/api/market/overview`, `/api/market/universe?limit=1`, `/api/market/heatmap?limit=1000`, `/`, and `/assets/index-BM-PutKc.js`. `GET /market/trending` and `GET /market/research/{symbol}` were not called.

Signal review was executed locally with `review_account` on `grc/signals/accounts.yaml`. The eight results are in the API inventory. That command does not contact Bluesky.

## Blocked or unverified

- No browser tool was available. Routing assertions are Vitest and jsdom. They are not browser acceptance.
- No isolated disposable PostgreSQL 17. Docker's daemon was not running, and no local PostgreSQL service was found. A new database on a shared server is not a substitute, because the grant script changes the cluster-wide `fintech_app` password.
- No Lightsail or AWS API call, so image digests, migration version, backups, and scheduler lease were not re-read.
- No hosted authenticated journey, and no account reconciliation.
- Provider terms, Alpha Vantage revocation evidence, and secret-manager status were not re-checked.
- `docs/security/AUDIT-001.md` high findings were not closed.

Phase 0 stays open while backup restore, account reconciliation, the authenticated browser journey, and the PostgreSQL proofs remain unverified here.
