# Sentinel Markets 2.0 backlog

Review units after the P0-A baseline on 2026-11-05. Commit under review: `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`.

Phase 0 is not complete. This backlog does not check any roadmap box. P0-B's revised harness and evidence have been reviewed. P1-A and P1-B are implemented and verified locally; see [P1A_VERIFICATION.md](P1A_VERIFICATION.md) and [P1B_VERIFICATION.md](P1B_VERIFICATION.md). P1-C provider ingestion remains gated by a written provider decision. Release/deployment and provider-permission limitations remain explicit.

An independent signed-in UI correction now removes the fabricated performance curve and daily-return labels; see [UI_DATA_TRUTHFULNESS.md](UI_DATA_TRUTHFULNESS.md). This does not declare the public dashboard redesign or performance-series work complete.

The public-market authored snapshot, generated sparklines, and timeframe multipliers are removed locally; see [PUBLIC_DATA_VERIFICATION.md](PUBLIC_DATA_VERIFICATION.md). That correction does not complete Phase 1.

P1-C cached status and history reads are local groundwork only. See [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md). The snapshot correction recorded there is a verified local pass: 25 focused tests passed, and the full backend passed 190 with 1 skipped on a fresh disposable PostgreSQL 17.11. SQLite pins the schema page before it samples the precise clock, so an earlier timestamp in the current second stays eligible and a later fraction stays future. A mutation check that put back the old `SELECT 1` failed both WAL clock regressions. History SQL stays limited to the inclusive two-year window, and `excluded_row_count` counts only rows inside that window. `collection: disabled` means canonical-history ingestion, not the existing quote refresh path. That verified read correction does not approve a provider, live history collection, public-display coverage, or an exchange calendar.

The backend CI job starts an isolated PostgreSQL 17 service, maps it to a localhost port, checks readiness with `pg_isready`, and sets a backend-job `AUDIT_DATABASE_URL` (`postgresql+psycopg`). Codex parsed the workflow YAML: the service environment and `AUDIT_DATABASE_URL` match, every non-backend job and top-level setting matches HEAD, and the job has exactly one pytest invocation. A fresh disposable local `postgres:17` container, using that CI user, database, and password, ran the full suite on local Python 3.14: 190 passed, 1 skipped, 615 warnings, 52.19 seconds. The skip is the missing Selenium opt-in browser module. The PostgreSQL proofs ran. The container was removed afterward. `git diff --check` passed. Review-branch overview CI later succeeded; see [P2_OVERVIEW_VERIFICATION.md](P2_OVERVIEW_VERIFICATION.md). The P2 initial shell and truthful dashboard-state slice is complete locally; see [P2_SHELL_VERIFICATION.md](P2_SHELL_VERIFICATION.md). That slice is not full P2. Full P1-C provider ingestion and the exchange calendar remain gated. Performance history, watchlists, new research, and forecast widgets are not implemented. No phase is complete.

On 2026-11-06 Codex accepted the P2 shell, overview, and Risk correction slice. Overview CI is in [P2_OVERVIEW_VERIFICATION.md](P2_OVERVIEW_VERIFICATION.md). Risk run 42184498741 on `7dbddce5646b7bafb358ee4c7078196e10bba720` succeeded; see [P2_RISK_VERIFICATION.md](P2_RISK_VERIFICATION.md). Roadmap 2.0 Phase 2 stays open for discovery, watchlists, and performance prerequisites.

On 2026-11-06 Codex accepted the P3-A first cached chart slice at `f1eb5a69f8a2622fb11dddca3cf5e3fe3df664f4`. CI run 42266086014 passed all 7 jobs. See [P3A_HISTORY_VERIFICATION.md](P3A_HISTORY_VERIFICATION.md). Indicator warm-up, a reviewed exchange calendar, provider approval, and live ingestion remain open. That acceptance does not complete P3-A or a broader phase, and it checks no roadmap box.

Passing the SQLite suite is evidence for P0-A. It is not evidence that a later phase is done.

P0-B progress on 2026-11-05 is recorded in [P0B_VERIFICATION.md](P0B_VERIFICATION.md): PostgreSQL proofs, isolated restore/upgrade/grants, local browser acceptance, hosted reconciliation/snapshot recovery, and active deployment image labels/digests. The revised browser guards and failure diagnostics passed review. Hosted frontend divergence remains recorded; image identity is verified, while source-commit build attestation is not established. [Provider source review](PROVIDER_ACCESS_REVIEW.md) is complete to its stated retrieval limits; actual data entitlements are not approved. The table below preserves the original P0-A state, not the latest P0-B status.

## Gates that stay explicit

| Gate | State after P0-A |
| --- | --- |
| Disposable backup and restore | Documented in [docs/aws_deployment.md](aws_deployment.md). Not executed here. P0-B requires a successful restore into an isolated instance, not a backup listing |
| Hosted account preservation and reconciliation | Documented for 2026-11-04 as 14 accounts. Not queried here. Authorized read-only operator checks stay separate from application login and browser mutations |
| Authenticated browser journey | Not run. Vitest covers routes in jsdom. The hosted bundle is still the pre-PR #15 research console. Login writes session and audit rows, so the journey needs a named test account and a named environment |
| Provider rights and access | Not reviewed. Yahoo is called by the scheduler path. Alpha Vantage is called by portfolio marks, immediate trades, trending, and research. Keys and terms were not inspected |
| Hosted and local divergence | Proven for the web bundle. Unproven for the API image digest and the database revision |
| PostgreSQL concurrency and grants | Six tests skipped because `AUDIT_DATABASE_URL` was unset and no disposable server was available. A fresh database on a shared server is not sufficient |

## Ordered review units

### P0-B. Remaining baseline verification

Scope: verify and record the baseline. Disposable restoration and test-account browser actions are limited to the boundaries below. Do not change application behavior, role assignments, JWT, or the hosted schema. Do not restore over the hosted database. Do not start P1-A.

Allowed areas: an isolated disposable PostgreSQL instance, read-only hosted checks, and a separate authenticated browser pass. No application source change unless a check is blocked by a harness defect, and that defect needs its own review.

Prerequisites: P0-A, this file set, present in `E:\fintechapp`.

PostgreSQL isolation:

- Use a disposable container or an equivalent instance that no other application uses.
- A new database on a shared PostgreSQL server is not acceptable.
- `app/scripts/configure_postgres_role.py` runs `ALTER ROLE fintech_app LOGIN PASSWORD` when that role already exists, and `CREATE ROLE` otherwise. The role is cluster-wide. Running the grant script on a shared server can change `fintech_app`'s password for every database on that server.
- Point `AUDIT_DATABASE_URL` only at the isolated instance. Record the instance boundary before the run.

Acceptance:

- Run `tests/test_audit_postgres.py` against that isolated PostgreSQL 17. Record pass, fail, or the exact blocker.
- Identify the application backup source, recovery point, format, and source schema version before restoring. Use a backup from the documented application recovery path, or a representative application backup with the same schema and accounting relationships. An unrelated sample database does not establish application recoverability. If the available backup does not prove hosted recovery, state that limitation explicitly.
- Restore only into an isolated disposable instance. Record the restore commands and successful exit, restored Alembic revision, expected tables and constraints, source-versus-restored row counts or digests, and account/ledger reconciliation. Verify required runtime grants in the isolated instance and record any grant reapplication. Keep background jobs disabled there. Keep dumps and account-level evidence in restricted, ignored storage; publish only redacted aggregate results. A snapshot listing, including `fintechapp-preview-data-20261031`, is not restore evidence. Never restore over the hosted database.
- Preserve the old-schema restore evidence before an upgrade rehearsal. To verify recovery onto the current application version, copy the restore to another isolated target, migrate that copy to the expected Alembic head, then apply the matching current grant script and reconcile again. Do not weaken the current grants or alter the development database to accommodate an older backup. Historical restore verification and current-version recovery are separate results.
- Public checks such as health may remain unauthenticated. Image metadata, database revision, backup metadata, and account/ledger reconciliation use existing authorized read-only operator access as needed. Read-only describes permitted effects, not the absence of credentials. Do not expose administrative endpoints or weaken authentication to collect evidence. Keep these checks separate from application login and browser mutations; print no credentials or private positions.
- Authenticated browser checks are a separate step. State the environment first: local, or the hosted service. Login writes session and audit records. Use a designated test account. Any paper order or cash click uses a designated test account, not an operator or customer account. Walk signed-out `/` and `/dashboard`, the top-right login control, `/market`, the signed-in dashboard, an expired session, and a protected compliance denial. Record URL, bundle hash, and viewport.
- Leave a written rollback note that matches the commands that were actually available.

Release boundary: still Phase 0. Do not mark Phase 0 complete if any of these stays blocked. Do not deploy.

### P1-A. Bulk portfolio pricing

This is the first implementation task. Do not start it inside the P0-A review.

Scope: `GET /portfolio/` valuation and the minimum client handling required for its complete/incomplete response contract. One consistent server-side snapshot. Bounded queries. Explicit missing prices. Precise money. No provider fetch per holding.

Allowed areas: `app/routers/portfolio.py`, a portfolio pricing helper, portfolio tests, `frontend/src/types/schemas.ts`, the portfolio/dashboard adapters and views, and the existing components/tests that consume their valuation fields. Client edits are limited to nullable values, valuation status, timestamps, and unavailable states; no redesign. Preserve existing summary keys. Adding nullability is an API compatibility change and must ship with its client handling in the same reviewed batch.

Do not change in this task:

- `POST /trades/` and `get_live_price`.
- Order matching, reservations, the quote band, or execution prices.
- Cash, ledger, roles, or migrations.
- The public dashboard and its fallback numbers.
- The broader repair of the signed-in daily-P&L labels and fabricated historical curve. That remains a separate UI task. P1-A must nevertheless suppress valuation-dependent P&L, weights, and charts when valuation is incomplete; the existing fallbacks must not turn unknown values into an apparently valid curve or daily return.

Current contract, from `app/routers/portfolio.py` and `app/services/price_service.py`:

- Each holding calls `get_live_price`. The outer price cache lasts 30 seconds. For a stock, `get_stock_quote` then uses a 300-second quote cache. A provider request happens only when both layers miss. One call per holding is not one provider request per holding.
- A missing key, a missing price, or a non-positive price raises HTTP 502 for the whole portfolio.
- The body has no `as_of`. Money is quantized, then returned as `float`.
- The signed-in dashboard still labels `total_pnl` as day P&L and draws a five-point interpolation labeled "Real 1D" when `/portfolio/pnl` is absent. Correcting the full-history behavior and daily labels remains outside this task. Preventing those fallbacks from presenting an incomplete valuation as complete is required in P1-A.

Replacement contract (implemented locally; see the verification note above):

- Return HTTP 200 for a successful portfolio read with complete or incomplete valuation. Database, authentication, and other request failures retain their normal error responses; they are not converted into missing-price success.
- Load cached quotes for held symbols in one bounded query. Do not call Alpha Vantage, Yahoo, `get_live_price`, or any other provider during the request. Preserve every owned nonzero holding, including an unsupported legacy asset as an unavailable position.
- Read account cash, holdings, reservations, and quotes from a consistent database view. Use a single statement or a correctly established read-only consistent transaction; a response timestamp alone does not guarantee consistency. Concurrent refresh or trading must not mix valuation inputs from different database states.
- Add top-level `valuation_status: "complete" | "incomplete"`, `snapshot_read_at` (UTC), and `unavailable_symbols`. The read timestamp describes when inputs were read, not when the market observed each price.
- Each position adds `price_status: "available" | "unavailable"`, nullable `unavailable_reason`, and nullable `source`, `quote_at`, and `fetched_at`. Quote and fetch times come from the selected cache row, not the request clock. Preserve known source/times even when that row is unusable; use null when absent.
- An eligible price is finite, positive, for the correct supported symbol/asset, and has a usable observation timestamp. Evaluate the cache's existing source-specific freshness rules against the fixed snapshot read time: Yahoo/Alpha Vantage use UTC calendar dates through seven days; other sources retain their existing elapsed-time thresholds. A `stale` result is unavailable; accepted delayed/cached prices remain visibly dated. Reject future-dated observations. Reasons distinguish `missing`, `invalid`, `stale`, and `unsupported_asset`. This valuation policy does not change execution-price or order-band policy.
- A position with an unavailable price retains quantity, average cost, and cost basis. Its `current_price`, `position_value`, `unrealized_pnl`, and `unrealized_pnl_pct` are null, never zero or book-cost substitutes. Other positions retain their available marks.
- Valuation is complete only when every nonzero position has an eligible price. With no positions, valuation is complete: securities value and unrealized P&L are zero; account value equals cash. An actual zero gain/loss remains numeric zero.
- If valuation is incomplete, set summary `total_portfolio_value`, `total_account_value`, `total_unrealized_pnl`, `total_unrealized_pnl_pct`, and `total_pnl` to null. Preserve independently known `cash_balance`, reservation-derived `buying_power`, `total_cost_basis`, and `total_realized_pnl`. Do not substitute cash plus the priced subset as total account value. Do not add a partial aggregate in P1-A.
- Keep Decimal arithmetic until the existing JSON numeric boundary. Document remaining numeric float fields and extend TypeScript types with explicit nullability and valuation status. Do not use type assertions to conceal nulls.
- Dashboard, portfolio, and their tables must show "Valuation incomplete" and unavailable values with a textual reason. Cash, buying power, cost basis, realized P&L, quantities, and available position marks remain inspectable. Dependent totals, allocation percentages, inferred position-risk labels, valuation charts, and valuation-based daily/total return displays remain unavailable. No `?? 0`, cash-only fallback, null arithmetic, or zero-default formatting may turn these unknown values into financial figures. Suppress an older separate P&L response when it would mask the current incomplete valuation.
- Update all in-repository consumers of changed fields in the same batch. A complete response preserves existing numeric summary behavior. Release backend and compatible clients together; any independently deployed client must be made null-aware first or use a reviewed versioned contract. Neither current live clients nor external clients are assumed compatible merely because keys are retained.

Required tests:

- Complete two-position and empty portfolios; precise marks and totals; no provider calls; bounded quote-query count as positions grow; account isolation.
- One available and one missing/invalid/stale/unsupported position: retain both positions, null dependent totals, preserve known accounting values, and report the reason and actual quote/fetch times. Cover the seven-day boundary and future timestamps.
- Retry with unchanged inputs produces the same financial result, apart from read metadata, and writes no account, cash, holding, order, lot, or ledger changes.
- A controlled concurrent update demonstrates a consistent pre-update or post-update valuation rather than mixed cash/holdings/quote state.
- UI tests for incomplete valuation with nonzero cash and an available holding: no cash-only account total, fabricated chart, misleading zero P&L, partial allocation denominator, or inferred low-risk label. Verify unavailable versus actual zero, and complete-response compatibility.

Release boundary: local only until a later deploy review. Not a Phase 1 completion by itself.

### P1-B. Canonical daily history

Scope: a reviewed daily series for held symbols and a named starter universe.

Local result: the additive canonical schema, series decision, migration, grants and isolated proofs are complete in [P1B_VERIFICATION.md](P1B_VERIFICATION.md). No universe was backfilled and no provider entitlement was approved. Legacy history remains separate.

Allowed areas: a new Alembic revision, the daily model, and migration tests on a fresh database and on a database upgraded from the current head.

Prerequisites: P0-B so the upgrade is not rehearsed on the hosted database. An adjustment decision: raw, split-adjusted, or both, recorded before backfill.

Acceptance: unique identity for symbol, session date, and series. Provenance and `fetched_at`. The current symbol-plus-date upsert is not reused as if it were that identity. Run the fresh database and the upgraded copy on an isolated PostgreSQL instance. The grant script changes the cluster-wide `fintech_app` password, so a shared server is not acceptable here either. No hosted backfill in the same change.

Release boundary: schema can deploy before any UI reads it. Empty history stays an unavailable chart, not a generated series.

### P1-C. Ingestion and data-status API

Scope: incremental daily ingestion and a status route.

Prerequisites: P1-B and a written provider decision.

Local groundwork only, 2026-11-05, uncommitted: `GET /market/data-status` and `GET /market/symbols/{symbol}/history` read cached canonical rows inside one snapshot. The contract is [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md). Synthetic fixtures and those cached reads are allowed. Provider adapters, backfill, and an ingestion writer are not implemented. `coverage_status` stays `not_verified` and `expected_session_count` stays null until a reviewed exchange calendar exists. This groundwork does not complete P1-C or Phase 1.

Acceptance: restart and retry do not duplicate a bar. Invalid OHLC is rejected. Exchange sessions explain gaps. Coverage is declared. The status route reports the hosted census shape that P0-A measured: universe count, cached count, and stale count. Provider backfill on the host waits for approval.

Release boundary: jobs stay bounded by the existing hot and daily limits until new limits are reviewed.

### P2. Shell and one dashboard slice

Scope: one agreed shell and one overview that uses real account and market responses.

Prerequisites: a design pass. P1-A before the overview shows account value. Widgets that need P1-C or P4 render an explicit unavailable state.

Acceptance: public `/` and `/market` stay public. Private account numbers stay behind a session. Keyboard and a narrow viewport. No authored SPX, NVDA, or sparkline values in the live widgets. The timeframe control either requests real history or it is removed.

Release boundary: visual only where the data is already real.

### P3-A. Chart slice

Prerequisites: P1-B history and a pinned Lightweight Charts review. The pin is [P3A_CHART_REVIEW.md](P3A_CHART_REVIEW.md).

The first cached chart slice is accepted. See [P3A_HISTORY_VERIFICATION.md](P3A_HISTORY_VERIFICATION.md). Head `f1eb5a69f8a2622fb11dddca3cf5e3fe3df664f4`, CI run 42266086014, all 7 jobs passed. Daily cached bars, missing-data behavior, resize, and unmount cleanup are in that slice. Indicator warm-up and a reviewed exchange calendar remain open. No intraday mode until intraday bars exist. Full P3-A is not complete.

Acceptance for the rest of P3-A: indicator warm-up, plus the exchange-calendar coverage that missing sessions still need. The cached slice does not close those items.

### P3-B. Ticket, lifecycle, and watchlists

Prerequisites: the existing order routes. Preview is a new non-mutating call.

Acceptance: ownership, reservations, idempotent replay, partial fill, cancel against a fill, and insufficient liquidity. Preview writes no cash, order, holding, lot, or ledger row. The dashboard quick trade remains the immediate `POST /trades/` path unless a reviewed change moves it onto the order book.

### P4-A. Performance

Prerequisites: P1-A snapshot and P1-B history.

Acceptance: hand-calculated deposits, withdrawals, buys, sells, fees if any exist, splits, missing prices, and a benchmark. Cash deposits are not investment return. Results reconcile to the ledger.

### P4-B. Risk and trade impact

Prerequisites: P4-A definitions for the quantile, the return interval, and the benchmark.

Acceptance: an independent reference calculation. The same snapshot as the portfolio. Account isolation. `POST /portfolio/trade-impact` and `POST /risk/scenarios` write nothing.

### Core release gate

CI, the browser journey, regression tests, the PostgreSQL proofs, backup and rollback, grants, and a deployment record. Open blockers stay visible. Research and forecast stay off.

### P5 and P6

Separate slices after the core gate. P5 needs a pinned TradingAgents revision, owned jobs, and no execution tool. P6 needs isolated inference, weight rights, a walk-forward baseline, and a disabled default. Neither slice is the next task.

P1-A, P1-B, the signed-in truthfulness correction, and the public-data correction remain local, in the notes linked above. The P1-C snapshot correction is the verified local pass in [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md): 25 focused tests passed; the full backend passed 190 with 1 skipped on a fresh disposable PostgreSQL 17.11; SQLite pins the schema page before the precise clock; putting back the old `SELECT 1` fails both WAL clock regressions. Those results verify the read corrections.

## Next task

The owned order-detail read API, then lifecycle UI, cancel-versus-fill proofs, chart integration, and watchlists. The owned order-detail contract will accompany that next unit and is absent from this commit. The preview/confirm ticket is accepted and is not the next task. Evidence: [P3B_TICKET_VERIFICATION.md](P3B_TICKET_VERIFICATION.md). Commit `90074df585c413b0305aa56d2197cbc5cde3d213` on `codex/v2-order-ticket-20261106`. [PR 19](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/19) is stacked on PR 18. [CI run 42327832410](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42327832410) succeeded on all 7 jobs. Codex review and CI accepted this ticket. This note does not claim a formal GitHub approval. Do not mark full P3-B done. This note checks no roadmap box.

The accepted backend preview remains `0aa62afd64a24bba2d659dc3044cebe6265e6929` on `codex/v2-order-preview-20261106` and is unchanged. Evidence: [P3B_PREVIEW_VERIFICATION.md](P3B_PREVIEW_VERIFICATION.md). Contract: [P3B_ORDER_PREVIEW_CONTRACT.md](P3B_ORDER_PREVIEW_CONTRACT.md). [PR 18](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/18) is stacked on PR 17. [CI run 42278953737](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42278953737) succeeded on all 7 jobs. Codex review and CI accepted that backend unit. Preview writes no cash, order, holding, lot, or ledger row. `POST /orders/` still revalidates. The existing immediate `POST /trades/` dashboard path stays unchanged. Matching and execution policies stay unchanged. That slice adds no new repository migration and no new grant policy. Existing migration and grant proofs ran only on isolated disposable instances. The hosted database had no migration or grant change. No merge or deploy.

The P3-A first cached chart slice is accepted and is not the next task. Indicator warm-up, a reviewed exchange calendar, provider approval, and live ingestion stay open. P4 and later, and the core release gate, stay open. Full phases stay open. This note checks no roadmap box.

PR 16 (https://github.com/slowgold05/Fintech-trading-risk-engine/pull/16) and PR 17 (https://github.com/slowgold05/Fintech-trading-risk-engine/pull/17) are ready. All 7 CI jobs are green. Main and the hosted service are unchanged. No merge, deploy, or hosted mutation.
