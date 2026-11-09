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

## 2026-11-09 — Phase 0 wrap-up re-check, before starting Phase 7

Re-verified the P0-B gates below against the current local branch
(`codex/v2-forecast-lab-frontend-20261108`, 156 commits ahead of `main`,
carrying every stacked, independently CI-green, still-unmerged PR from P1-A
through Phase 6 — PR numbers run from #2 to #81). `main` itself is unchanged:
still `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`, the same commit
[docs/PRODUCT_V2.md](PRODUCT_V2.md), [docs/FRONTEND_AUDIT.md](FRONTEND_AUDIT.md),
and [docs/API_INVENTORY.md](API_INVENTORY.md) describe. Those three files are
not rewritten here — Phases 1 through 6 are each independently contracted and
verified in their own `docs/P*_CONTRACT.md`/`docs/P*_VERIFICATION.md` pair
(listed in `ls docs/P*`), and this backlog file is the one kept current unit
by unit; rewriting the three frozen baseline docs to re-describe all of that
would just duplicate evidence that already exists elsewhere in more detail.

Fresh evidence collected today, in a new temporary Python 3.11 virtualenv
(`requirements.txt` + `requirements-dev.txt`, neither
`requirements-research.txt` nor `requirements-forecast.txt`), with
`AUDIT_DATABASE_URL` unset and a unique `--basetemp`:

```text
python -m pytest -q -rs --tb=line
500 passed, 29 skipped, 353 warnings in 122.27s
```

The 29 skips are the same, already-understood categories as every prior run
this session: 7 browser tests (no `selenium` installed in this venv), 1
`test_forecast_kronos.py` case (no `pandas`, expected per
[FORECAST_LAB_OPEN_LIMITATIONS.md](FORECAST_LAB_OPEN_LIMITATIONS.md)), and 21
PostgreSQL-only proofs across `test_audit_postgres.py`,
`test_daily_history_migrations.py`, `test_order_cancel_postgres.py`,
`test_order_detail_postgres.py`, `test_order_preview_postgres.py`,
`test_watchlist_migrations.py`, and `test_watchlists_postgres.py` (all
`AUDIT_DATABASE_URL is not set`). One rerun without changes reproduced the
same 500/29 split with zero failures; an earlier single run that same session
had 1 unrelated transient failure that did not reproduce, consistent with
this project's own established Windows-local-flake pattern, not a regression.

```text
cd frontend && npm test -- --run && npm run build && npm run lint
Test Files  30 passed (30)
     Tests  417 passed (417)
vite build: exit 0 (same pre-existing >500kB chunk-size warning)
eslint: exit 0
```

Re-checked whether the PostgreSQL gate below could finally be closed: Docker's
daemon is still not running (`docker info` fails), there is still no
`com.docker.service` Windows service registered, and no local PostgreSQL
service was found. This is the same blocker recorded in P0-B and in every
prior PR's CI-flake triage this session. Starting Docker Desktop (a GUI
application) unattended, with the user away from the machine, was judged out
of scope for this session to attempt unprompted — left open, not closed.

No hosted/AWS check, authenticated browser journey, backup restore, or
account reconciliation was attempted here, for the same reason as every prior
entry in this file: none of that is reachable from this sandboxed dev
environment. Phase 0 stays open on exactly the same five items the gate table
already names. What changed today is confirmation, not closure: the
already-huge amount of roadmap work built on top of this baseline (P1
through Phase 6, now all local-only and unmerged) does not change any of
Phase 0's own release-blocking gates, and does not promote any of it from
"implemented locally" to "verified deployed."

Per the user's own instruction, the next unit after this check is Phase 7
("Validation, hardening, and release"), not a new P1-P6 feature. Phase 7
itself names "Verified core Phases 0–4" as a dependency it does not yet have
— so, same discipline as every phase before it, work done under Phase 7 in
this session will be scoped to what is actually reachable locally (rerunning
and recording suite results, exercising existing journeys in the test suite,
reviewing for the security/data-integrity items that are code-level rather
than infrastructure-level) and will explicitly flag, rather than silently
skip, the staging/production/browser items that depend on access this
session does not have (7.2's real-browser pass, 7.4's staged rollout, and any
of 7.3's items that require a deployed environment).

## Gates that stay explicit

| Gate | State after P0-A |
| --- | --- |
| Disposable backup and restore | **Local mechanism proven 2026-11-09** once Docker became available — see [P0B_LOCAL_RESTORE_VERIFICATION.md](P0B_LOCAL_RESTORE_VERIFICATION.md): the documented `pg_restore` command, full migration chain, and grant reapplication all verified end-to-end on synthetic data across two disposable containers. Hosted recovery itself was already proven separately in [docs/aws_deployment.md](aws_deployment.md) (2026-10-31) and is not re-verified here — no AWS access in this session |
| Hosted account preservation and reconciliation | Documented for 2026-11-04 as 14 accounts. Not queried here. Authorized read-only operator checks stay separate from application login and browser mutations |
| Authenticated browser journey | Not run. Vitest covers routes in jsdom. The hosted bundle is still the pre-PR #15 research console. Login writes session and audit rows, so the journey needs a named test account and a named environment |
| Provider rights and access | Not reviewed. Yahoo is called by the scheduler path. Alpha Vantage is called by portfolio marks, immediate trades, trending, and research. Keys and terms were not inspected |
| Hosted and local divergence | Proven for the web bundle. Unproven for the API image digest and the database revision |
| PostgreSQL concurrency and grants | **Closed 2026-11-09**, once Docker became available. See [P0C_POSTGRES_CONCURRENCY_VERIFICATION.md](P0C_POSTGRES_CONCURRENCY_VERIFICATION.md): 7/7 passed on a fresh disposable `postgres:17` container (not the user's own long-running dev container), full suite 530 passed/8 skipped with `AUDIT_DATABASE_URL` set |

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

2026-11-09, continuing further: also used Docker to advance the
"Disposable backup and restore" gate — see
[P0B_LOCAL_RESTORE_VERIFICATION.md](P0B_LOCAL_RESTORE_VERIFICATION.md).
Two fresh disposable containers (never the user's own dev container):
seeded one with representative synthetic accounting data via the app's
own ORM models, dumped it with the exact `pg_dump`/`pg_restore` flags
`aws_deployment.md`'s own hosted rehearsal used, restored into a second
fresh container, and confirmed an exact match — Alembic revision
`45d85a1871f0` and every row count identical to the source — plus grant
reapplication and a clean 7/7 on `tests/test_audit_postgres.py` against
the restored instance. This proves the restore *mechanism* end-to-end for
the first time this session; it does not re-prove hosted recovery (no AWS
access here), which `aws_deployment.md` already covers separately.
Containers and the local dump file were destroyed immediately after.

Of the six original gates, two are now closed (PostgreSQL concurrency and
grants; the local restore-mechanism proof above) and four remain
genuinely blocked without hosted/browser access this sandboxed environment
doesn't have (hosted account reconciliation, authenticated browser
journey, provider rights review, hosted/local divergence).

2026-11-09, resuming: the user started Docker Desktop and a local Ollama
instance and said to proceed, resolving the single biggest standing
blocker this entire session. Closed Phase 0's "PostgreSQL concurrency and
grants" gate for real — see
[P0C_POSTGRES_CONCURRENCY_VERIFICATION.md](P0C_POSTGRES_CONCURRENCY_VERIFICATION.md).
Used a fresh, disposable `postgres:17` container on port 5555 (CI's own
public `ci_audit`/`ci-only-test` credentials, not a secret) — never the
user's own long-running `fintechapp-postgres` container on port 5433,
which holds real locally-migrated application data and was never touched.
7/7 passed on a freshly recreated container; full suite 530 passed/8
skipped with `AUDIT_DATABASE_URL` set (down from 29 skipped). Caught and
resolved a false alarm along the way: reusing the same container across
several manual test invocations left behind residual rows that broke two
concurrency tests' dedup assumptions (`assert [0, 2] == [0, 1]`) —
looked like a real locking bug at first, resolved by recreating a
genuinely fresh container and confirming 7/7 passed repeatably; not a
product bug, a reused-disposable-container artifact. Also ran the
previously mocked-only AI-usage token capture (PR 87) against the real
local `qwen3:14b` Ollama model for the first time — `prompt_tokens: 74,
completion_tokens: 567, duration_ms: 95046`, matching measured wall-clock
time — see the addendum in
[P73_AI_USAGE_VERIFICATION.md](P73_AI_USAGE_VERIFICATION.md).

Per the user's explicit instruction, continuing the roadmap now without
stopping. Still open: the other five rows in the gates table (disposable
backup/restore, hosted account reconciliation, authenticated browser
journey, provider rights review, hosted/local divergence) are unrelated
to Postgres/Docker and remain blocked on hosted/browser access this
sandboxed environment does not have.

2026-11-09, pausing here at the user's request (laptop going to sleep,
work resumes later): CI on PRs 87, 88, and 89 came back with a genuine
regression, not a flake — `backend`'s `test_audit_postgres.py` and
`browser`'s `test_p0b_acceptance.py` both hardcode an expected Alembic
head revision (`ALEMBIC_HEAD`/an inline assertion), and PR 87's new
migration (`45d85a1871f0`) moved the real head forward without those two
constants being updated. CI's disposable-PostgreSQL job caught it exactly
as it should: `assert '45d85a1871f0' == 'c5a9e2d8b417'` — proof the
migration itself applied cleanly against a real database, only the test
constants were stale. Fixed by committing the two-line fix on PR 87's
branch first, then merging it forward into PR 88's and PR 89's branches
(clean merges, no conflicts) and pushing all three. CI was re-running on
all three as of this note; not yet confirmed green — that's the first
thing to check on resuming (`gh pr checks 87`, `88`, `89`).

Everything else from this session stands: Phase 7.1 (both units) and
Phase 7.3 (license review, dependency vulnerabilities, research-tool
isolation, operational monitoring including AI usage) are done from what's
reachable in this sandboxed environment; 7.2/7.4 remain explicitly open
and unreachable without a live browser or AWS/staging access. PR 89 also
picked up one genuinely-still-open small gap (risk metrics card's range
selector). `main` is still unchanged at
`be8ffdc19f78d2942b5e9922ce605d6a5de7d472`; none of PRs #2 through #89 are
merged, and none should be without the user's own explicit authorization.

2026-11-09, continuing further still: with Phase 7 now covering everything
locally reachable, PR 89 (stacked on 88) picks up a genuinely still-open
small gap flagged in an earlier backlog entry (the PR #60 paragraph
below): the risk metrics card's range selector was hardcoded to `1y` even
though `fetchRiskMetrics` and the backend endpoint already support `2y`.
See [P4F_RISK_METRICS_RANGE_VERIFICATION.md](P4F_RISK_METRICS_RANGE_VERIFICATION.md).
Checked the live code first rather than trusting the older paragraph at
face value — a neighboring item flagged the same way (Bollinger Bands
"upper/lower not yet parsed or plotted") turned out to already be fully
shipped in a later PR, so the backlog's append-only older entries are not
all still accurate; this risk-metrics gap, unlike that one, checked out as
real. Frontend-only change (`frontend/src/pages/Portfolio.tsx`): a
`<select>` in the card's existing `action` slot, driving the query
key/`fetchRiskMetrics` call and the card's own title text. No backend
change needed. `npm run lint`/`build`/`test -- --run` all clean, 417 tests
unchanged (no dedicated test file exists for this page, same disclosed gap
as PRs #55-#60 on this same card — not newly introduced here). Implemented
directly rather than through Grok given the size of the change (under 15
lines).

`main` is still unchanged at `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`;
PR 89, like every other open PR (#2 through #89), is not merged.

2026-11-09, continuing further still: PR 88 (Phase 7.1, stacked on 87)
closes the remaining slice of roadmap 7.1's original scope — partial
fills, rejections, and duplicate submissions chained inside a trader
journey, not just covered in isolation. See
[P71B_JOURNEY_EXTENSION_CONTRACT.md](P71B_JOURNEY_EXTENSION_CONTRACT.md)
and [P71B_JOURNEY_EXTENSION_VERIFICATION.md](P71B_JOURNEY_EXTENSION_VERIFICATION.md).
One new test function added to the existing
`tests/test_p7a_trader_journey.py` (no other file touched, no application
code changed): a market buy against a smaller resting limit sell confirms
the real `place_order` partial-fill behavior (unfilled remainder
`"canceled"`, not resting; portfolio shows only the filled quantity); an
oversized limit buy sized from the buyer's own live buying power confirms
a clean `400` rejection with buying power left untouched; and a fixed
`Idempotency-Key` resubmitted with the same payload confirms a byte-for-byte
replayed response with no second row written to `orders`/`trades`.
Independently reran: both journey tests pass (2/2), full suite 511 passed,
29 skipped, zero failures.

FIFO lot allocation and realized P&L are deliberately not re-tested here —
already covered in depth by `tests/test_portfolio_attribution.py`; this
unit only adds the partial-fill/rejection/idempotency pieces the first 7.1
test didn't chain together yet.

With this, everything locally reachable in Phase 7 that doesn't require a
live browser, AWS/staging access, or a product decision only the user can
make (the `typescript-eslint` major-version bump) is now done: Phase 7.1
(both units), Phase 7.3 (license review, dependency vulnerabilities,
research-tool isolation confirmed clean, operational monitoring including
AI usage). 7.2 and 7.4 remain explicitly open and unreachable from this
sandboxed environment — `claude-in-chrome` was checked this session and
confirmed to have no connected MCP tools (only the skill wrapper, which
needs the user's own live browser extension), so a real browser pass
genuinely cannot be attempted unattended. `main` is still unchanged at
`be8ffdc19f78d2942b5e9922ce605d6a5de7d472`; PR 88, like every other open
PR (#2 through #88), is not merged.

2026-11-09, continuing further still (PRs 85 and 86 confirmed CI-green and
marked ready — all 7 jobs passed on both, `gh pr ready` returned "already
ready" for each): PR 87 (Phase 7.3, stacked on 86) adds AI usage
instrumentation — [P73_AI_USAGE_CONTRACT.md](P73_AI_USAGE_CONTRACT.md) and
[P73_AI_USAGE_VERIFICATION.md](P73_AI_USAGE_VERIFICATION.md). This closes
the last open item in roadmap 7.3's "operational monitoring for data
freshness, job age, retries, and AI cost" bullet.

Leading finding: both of this app's LLM paths
(`app/services/research_llm.py`, `app/services/research_tradingagents.py`)
are hardcoded to a local Ollama model (`llm_provider = "ollama"`,
`research_llm_base_url` defaulting to `localhost:11434`) — zero
`openai`/`anthropic` imports or API-key settings exist anywhere in `app/`.
There is no dollar AI cost to monitor today, and nothing was fabricated to
pretend otherwise. What was added instead: capturing the token counts and
latency Ollama's own `/api/generate` response already returns
(`prompt_eval_count`, `eval_count`, `total_duration`) but this app was
previously discarding, persisting them on `ResearchJob` via a new
migration (3 nullable `Integer` columns), and surfacing a new `ai_usage`
block on `GET /compliance/ops-health` (sums/averages over rows that have
data; explicit zero, not an error, when none do). The TradingAgents
synthesis path has no equivalent counts available and correctly keeps
those columns `NULL` rather than guessing. `forecast_jobs` (the Kronos
local-inference path) is untouched — out of scope, not an LLM call.

Caught one real bug before dispatch: `research_worker.py`'s
`ResearchReport(**synthesis_fields)` would have broken if the new keys
were added straight to `generate_synthesis`'s return dict, since
`ResearchReport` has no matching columns — the contract was corrected to
`.pop()` the three keys off `synthesis_fields` and assign them onto `job`
directly before that constructor call, and Grok's actual diff implements
exactly that. Independently reran the three touched test files (27 passed)
and the full suite (510 passed, 29 skipped, zero failures) after reviewing
every file in the diff line-by-line against the contract.

The migration itself was not applied against a live database — this
project's test fixtures build schema via `Base.metadata.create_all`, never
by running Alembic, for any migration in the repo, and Docker is still not
running in this sandboxed environment (same disclosed boundary as Phase
0's own re-check). Verified by code review against the existing
migration-file style instead.

Roadmap 7.3 is now fully addressed from what's reachable in this sandboxed
environment: license review done, dependency vulnerabilities addressed
(partially — the frontend's remaining 7 moderate findings need an unmade
`typescript-eslint` v9 decision), data-provider usage rights already
covered by `docs/PROVIDER_ACCESS_REVIEW.md`, and operational monitoring
(freshness, job age, failures, AI usage) now has its first real endpoint.
7.2 (browser pass) and 7.4 (staged rollout) remain explicitly open and
unreachable from here. `main` is still unchanged at
`be8ffdc19f78d2942b5e9922ce605d6a5de7d472`; PR 87, like every other open
PR (#2 through #87), is not merged — none will be without the user's own
explicit authorization.

2026-11-09, continuing further: PR 86 (Phase 7.3, stacked on 85) adds
`GET /compliance/ops-health` — [P73_OPS_HEALTH_CONTRACT.md](P73_OPS_HEALTH_CONTRACT.md)
and [P73_OPS_HEALTH_VERIFICATION.md](P73_OPS_HEALTH_VERIFICATION.md). This is
the first slice of roadmap 7.3's last bullet ("operational monitoring for
data freshness, job age, retries, and AI cost"): one read-only,
compliance-gated endpoint reusing the heatmap's existing `_freshness`
classification for market-data staleness, plus queued/running/oldest-age/
failed-24h counts for `ResearchJob` and `ForecastJob`. Deliberately does not
add a `retries` field (neither job model nor worker has a retry mechanism to
report on) or an AI-cost field (no LLM call site anywhere captures token or
dollar cost yet) — both gaps are named in the contract rather than
fabricated. No new metrics storage, no dashboard, no alerting; a single
request-time read over existing tables. Implemented by Grok inside a
two-file scope (`app/routers/compliance.py`, new
`tests/test_p73_ops_health.py`), independently reviewed line-by-line against
the contract and rerun: 5/5 new tests pass; full backend suite passed
506/29-skipped clean on a second run after one unrelated, pre-existing
timing-sensitive test (`test_market_history.py`'s clock-sample test, in a
file this unit never touched) flaked once and then passed both isolated and
in a second full run.

This leaves roadmap 7.3 with only AI-cost instrumentation still unaddressed
(a bigger, separate unit — would mean instrumenting every LLM call site to
capture and persist usage data, not a monitoring read over data that
doesn't exist yet). 7.2 (browser pass) and 7.4 (staged rollout) remain
unreachable from this sandboxed environment. `main` is still unchanged at
`be8ffdc19f78d2942b5e9922ce605d6a5de7d472`; PR 86, like every other open PR,
is not merged.

2026-11-09, continuing the same session: PR 85 (Phase 7.3, stacked on 84)
adds [P73_LICENSE_REVIEW.md](P73_LICENSE_REVIEW.md), the license half of
roadmap 7.3's "review third-party licenses, notices, dependency
vulnerabilities, and data-provider usage rights" (the vulnerability half was
already done in PR 84). Findings: 358 npm packages and 75 Python packages
(`requirements.txt` + `requirements-dev.txt`) all carry permissive licenses
(MIT/BSD/Apache-2.0/ISC family) with zero unknowns and zero copyleft beyond
two unmodified, non-distributed LGPL-3.0/MPL-2.0 dependencies (`psycopg`,
`certifi`, `hypothesis`) used exactly as their own licenses intend. The
`tradingagents` git-pinned package (`v0.7.1`) is Apache-2.0 per GitHub's own
repo metadata, checked without installing its heavy dependency tree.
Installing a license-scanning CLI via `npx` was attempted first and declined
by this session's own permission classifier (new unreviewed code execution,
unattended); the review was redone by reading already-installed packages'
own license metadata directly instead, which is a disclosed methodology
note, not a coverage gap.

This closes the license-review portion of roadmap 7.3. Still open in 7.3:
operational monitoring for data freshness/job age/retries/AI cost (no
observability stack exists today; building one is a real feature, scoping
it is the natural next unit, not attempted in this pass). 7.2 (browser pass)
and 7.4 (staged rollout) remain unreachable from this sandboxed environment.
`main` is still unchanged at `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`;
PR 85 is not merged, same as every other open PR.

PRs 82, 83, and 84 are all ready with CI green, stacked on 81. PR 82 is the
first Phase 7.1 unit (the consolidated trader-journey test). PR 83 and 84 are
Phase 7.3 units: the TradingAgents vendor-doc gap, and a dependency-vulnerability
pass (`npm audit fix` for the frontend's dev-only `typescript-eslint` chain,
plus `pip-audit` confirming the backend's `requirements.txt`/`requirements-dev.txt`
have no known vulnerabilities). Alongside those, a code-level review (not its
own PR, since nothing needed to change) confirmed roadmap 7.3's "research
tools cannot access order mutations or unrestricted secrets" item: both
`app/services/research_llm.py`'s and `app/services/research_tradingagents.py`'s
synthesis functions take only a symbol and a date, never a database session,
a JWT secret, or any mutation function, and `generate_tradingagents_synthesis`'s
own `final_trade_decision` field is LLM-generated text returned to the caller,
never executed against `place_order` or any other mutation path — this was
already true by the Phase 5 contract's own design, not a new fix.

Still open in Phase 7.3, not done here: a license review of third-party
dependencies (distinct from the vulnerability pass just done), and
operational monitoring for data freshness/job age/retries/AI cost (roadmap
7.3's last bullet) — this app has no observability stack today, and building
one is a real feature, not a quick audit step; scoping that is a reasonable
next unit, not attempted in this pass. 7.2 (a real browser/accessibility
pass) and 7.4 (staged rollout) remain explicitly open and unreachable from
this sandboxed dev environment, same as Phase 0's own still-blocked gates.

With PR 81 ready (above) and the 2026-11-09 Phase 0 re-check recorded, Phase 6
is fully built end to end, every PR from #2 through #81 is independently
CI-green and ready, and `main` is still unchanged at
`be8ffdc19f78d2942b5e9922ce605d6a5de7d472`. Per the user's own instruction,
the next unit is Phase 7 ("Validation, hardening, and release"), not a new
feature phase. Phase 7 itself names "Verified core Phases 0–4" as a
dependency it does not yet have (Phase 0's own five gates above are still
open), so the plan is the same discipline every phase so far has used: scope
one concrete, reachable-from-here Phase 7.1 unit — a consolidated,
contract-first end-to-end regression test exercising the full documented
trader journey (search → symbol → chart → preview → submit → order state →
fill/cancel → portfolio, both market and limit orders, partial fills,
rejections, reservations, duplicate submissions, and post-trade
reconciliation of holdings/cash/realized P&L/FIFO lots/ledger) — rather than
attempting 7.2's real-browser pass, 7.3's deployed-environment items, or
7.4's staged rollout, none of which are reachable from this sandboxed dev
environment without AWS/staging access this session does not have. Those
stay explicitly open, the same way Phase 0's own gates do.

[PR 81](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/81) is ready
with all CI checks green: the Forecast Lab frontend — a new `/forecasts` page, the
chart UI (roadmap section 6.2), closing out Phase 6's own checklist. Queue a
forecast job, watch its status, cancel a still-queued one, view a completed
forecast as a chart separating observed history (candlesticks) from the generated
path (a dashed line, deliberately not a second candlestick series), see the
configured model's status, and see whether it has ever been evaluated (honestly:
not yet). No drawn vertical cutoff line (lightweight-charts v5 has no built-in
primitive) — a text caption instead, disclosed as deliberate. No backend changes.
`DailyHistory.tsx`/`DailyHistoryCanvas` confirmed byte-identical — the new chart
component is fully independent. Evidence:
[P6F_FORECAST_LAB_FRONTEND_VERIFICATION.md](P6F_FORECAST_LAB_FRONTEND_VERIFICATION.md);
design: [P6F_FORECAST_LAB_FRONTEND_CONTRACT.md](P6F_FORECAST_LAB_FRONTEND_CONTRACT.md).
**With this PR, Phase 6 (Experimental Forecast Lab) is fully built end to end** —
model wrapper, job intake, worker, models/evaluations routes, walk-forward
evaluation methodology, and now the chart UI — thirteen stacked PRs (#69-#81) so
far this session, all independently-CI-green, none merged. The one thing
explicitly NOT done, by design, across every Phase 6 unit: no real Hugging
Face download, no real Kronos inference, no real walk-forward evaluation against
real weights has ever been run — every test and governance artifact is shape/
guard validation only, consistently disclosed. Per the user's own stated plan:
next is Phase 0's formal baseline-audit wrap-up, then the rest of the roadmap in
order (Phase 7). A separately-discovered small follow-up remains tracked but not
yet done: PR #74 (TradingAgents) introduced outbound Yahoo/SEC EDGAR/FRED calls
through its own internal data layer without a `grc/vendors/` entry.

[PR 80](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/80) is ready
with all CI checks green: roadmap section 6.3's walk-forward evaluation
methodology — the roadmap's own named gate before any "broad exposure" of the
Forecast Lab. Builds the evaluation **methodology itself** as real, tested code:
non-overlapping rolling windows, point-in-time correctness, a
last-observed-close baseline comparison, per-window error reporting — verified
against four hand-derived reference numbers before implementation.
`app/services/forecast_evaluation.py` is a **pure module with zero dependency on
`torch` or any Kronos code**, always testable regardless of whether the optional
forecast dependencies are installed. The Kronos adapter lives only in a new
offline script (not CI-invoked), which **correctly identified and documented a
real limitation rather than building a broken adapter**: `generate_forecast`
always reads the *latest* cached history, not a point-in-time historical cutoff,
so wiring it directly into this harness today would leak future data into every
historical window — the script exits non-zero and writes nothing rather than
storing a fake "real" result. `ForecastEvaluation` has no `user_id` column — a
model-governance artifact like `grc/models/`'s own cards and reports, not a
per-user resource — so `GET /forecasts/evaluations` lists every row to any
authenticated user. No `POST` route to trigger an evaluation on demand;
deliberately offline/administrative. Evidence:
[P6E_FORECAST_EVALUATION_VERIFICATION.md](P6E_FORECAST_EVALUATION_VERIFICATION.md);
design: [P6E_FORECAST_EVALUATION_CONTRACT.md](P6E_FORECAST_EVALUATION_CONTRACT.md).
**With this PR, Phase 6's entire named API surface exists** — ten stacked PRs
(#69-#80) so far this session, all independently-CI-green, none merged. Still
fully open: the chart UI (no frontend for any of Phase 6's routes yet), and
actually wiring/running a real evaluation against real Kronos weights (requires
first fixing `generate_forecast`'s own "always reads latest history" limitation
this unit's own offline script surfaced — not attempted by any unit so far). Per
the user's own stated plan: once Phase 6 is fully done, next is Phase 0's formal
baseline-audit wrap-up, then the rest of the roadmap in order (Phase 7).

[PR 79](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/79) is ready
with all CI checks green: `GET /forecasts/models`, a small read-only route. This
app configures exactly one forecast model (Kronos, via settings), not a dynamic
catalog, so the response describes that one model's current state — enabled or not,
its bounds, its pinned source commit and license — reading live settings rather
than a hardcoded value (verified by a test that flips `forecast_kronos_enabled` and
confirms the response changes accordingly). `source_commit` reuses the exact same
literal value PR #76 vendored, not a second independently-typed copy. `GET
/forecasts/evaluations` deliberately not built here — meaningless until roadmap
6.3's walk-forward evaluation methodology exists and produces something to list.
Evidence: [P6D_FORECAST_MODELS_VERIFICATION.md](P6D_FORECAST_MODELS_VERIFICATION.md);
design: [P6D_FORECAST_MODELS_CONTRACT.md](P6D_FORECAST_MODELS_CONTRACT.md). **With
this PR, every named Phase 6 route except `GET /forecasts/evaluations` exists** —
nine stacked PRs (#69-#79) so far this session, all independently-CI-green, none
merged. Still fully open: the chart UI, and — the real gate before any broad
exposure — the roadmap's own 6.3 walk-forward historical validation against
baselines, not attempted by any unit so far. Per the user's own stated plan: once
Phase 6 is fully done, next is Phase 0's formal baseline-audit wrap-up, then the
rest of the roadmap in order (Phase 7).

[PR 78](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/78) is ready
with all CI checks green: the bounded worker that actually drains the forecast job
queue PR #77 built intake for, closely mirroring PR #71's own research-worker
shape, plus the result-reading routes PR #71 also added in the same PR (`GET
/forecasts`, `GET /forecasts/{forecast_id}`). **Wires in
`settings.forecast_kronos_enabled`** (declared in PR #76, never actually checked
anywhere until now — there was no caller to gate before this unit existed). Unlike
research jobs, where an optional synthesis addendum sits on top of an already-useful
job, a forecast job's entire purpose is the Kronos call — so the worker does not
silently skip disabled jobs (leaving them stuck `queued` forever); it fails them
immediately with a specific, diagnosable `error_message`, distinct from a
"dependencies not installed" error, landing in the same failure path as any other
error. Every argument passed to `generate_forecast` is replayed unchanged from the
job's own stored row. Wired into the scheduler as an eighth step, bounded by a new
`scheduled_forecast_job_limit` setting defaulting to **1** — tighter than every
other scheduled-step limit, reflecting that a single real Kronos job can plausibly
take minutes. Evidence:
[P6C_FORECAST_WORKER_VERIFICATION.md](P6C_FORECAST_WORKER_VERIFICATION.md); design:
[P6C_FORECAST_WORKER_CONTRACT.md](P6C_FORECAST_WORKER_CONTRACT.md). **Still fully
open for Phase 6**: the chart UI, `GET /forecasts/models`/`GET
/forecasts/evaluations`, and — the real gate before any broad exposure — the
roadmap's own 6.3 walk-forward historical validation against baselines, not
attempted by any unit so far.

[PR 77](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/77) is ready
with all CI checks green: the job-queue **intake** surface for Phase 6 (Experimental
Forecast Lab) — `POST /forecasts/jobs`, `GET /forecasts/jobs`, `GET
/forecasts/jobs/{job_id}`, `POST /forecasts/jobs/{job_id}/cancel`, closely mirroring
PR #70's own research-job intake. **No worker exists yet** — a job only ever reaches
`queued` (on creation) or `cancelled` (via cancel). A forecast job stores
`generate_forecast`'s own keyword arguments (`provider`/`adjustment_type`/
`lookback`/`horizon`/`sample_count`) at creation time so the worker (a later unit)
can replay them unchanged; intake validates `adjustment_type` against the existing
`SUPPORTED_ADJUSTMENTS` constant and the three numeric bounds against the same
`forecast_kronos_max_*` settings `generate_forecast` (PR #76) itself checks — a
request that would definitely be rejected later never reaches the queue. A tighter
5-job cap than research jobs' 10, reflecting that a real Kronos inference call is far
more compute-heavy per job. Evidence:
[P6B_FORECAST_JOBS_VERIFICATION.md](P6B_FORECAST_JOBS_VERIFICATION.md); design:
[P6B_FORECAST_JOBS_CONTRACT.md](P6B_FORECAST_JOBS_CONTRACT.md). Still fully open for
Phase 6: the bounded worker (6.C, mirrors Phase 5's own PR #71), `GET
/forecasts/{forecast_id}`/`GET /forecasts/models`/`GET /forecasts/evaluations`, the
chart UI, and — the real gate before any broad exposure — the roadmap's own 6.3
walk-forward historical validation against baselines, not attempted by any unit so
far.

[PR 76](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/76) is ready
with all CI checks green: the first unit of roadmap Phase 6 (Experimental Forecast
Lab) — the Kronos model wrapper only, no job queue, no API route, no chart UI yet
(mirrors Phase 5's own decomposition into stacked units). Kronos
(`shiyu-coder/Kronos`, MIT, pinned commit `67b630e`) is not pip-installable, so its
three `model/` source files are vendored byte-identical under `app/vendor/kronos/`
with the MIT license retained verbatim; heavy runtime deps (`torch`, `pandas`, etc.)
live only in a new, separate `requirements-forecast.txt`, never `requirements.txt`.
**Discovered and followed this app's existing model-governance process** rather than
inventing a new one — `app/services/forecast.py`'s pre-existing honest `SM-FC-01`
historical-volatility placeholder already has its own model card/validation
report/inventory entry; this unit adds a second, separate `SM-FC-02` entry for
Kronos following the same honesty discipline (explicitly pending model owner review,
explicitly stating no walk-forward accuracy evaluation has been performed and real
weights were not downloaded or exercised). Also closed the vendor-register gap this
same discovery surfaced for Kronos itself (`grc/vendors/huggingface.md` + a
`docs/vendors.md` row). Future forecast timestamps follow real NYSE trading sessions
via the existing `exchange_calendar` module, verified against two hand-checked
reference vectors. Caught and fixed one real gap during review (a bare `pandas`
import left out of the dependency guard, masked locally because pandas happened to
already be installed in this dev environment unrelated to the project) and one CI
failure after that fix (the same gap meant one test needed `pandas` to build its own
fixture and couldn't run without it — fixed via `pytest.importorskip`, the same
convention this repo already uses for optional Selenium-dependent browser tests).
Evidence: [P6A_KRONOS_WRAPPER_VERIFICATION.md](P6A_KRONOS_WRAPPER_VERIFICATION.md);
design: [P6A_KRONOS_WRAPPER_CONTRACT.md](P6A_KRONOS_WRAPPER_CONTRACT.md). **Disclosed
boundary**: no real Hugging Face download or real Kronos inference was run as part
of building or verifying this unit. **Still open before Phase 6 is done**: the job
queue, bounded worker, `/forecasts/*` routes, chart UI, and — the real gate — the
roadmap's own 6.3 walk-forward historical validation against baselines, which this
unit explicitly does not attempt. **Also still open**: the separately-discovered
vendor-register gap in PR #74 (TradingAgents' own outbound Yahoo/SEC EDGAR/FRED calls
lack a `grc/vendors/` entry), tracked as its own small follow-up, not fixed here.

[PR 75](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/75) is ready
with all CI checks green: the first frontend surface for any of Phase 5's six backend
routes (PRs #69-#74) — a new `/research` page to queue a research job, watch its
status, cancel a still-queued one, view a completed report, and browse personalized
daily briefs. No backend changes — pure wiring against what already ships.
**Deliberately no auto-polling** — the scheduler runs on a long configurable interval
(default 24h), so a refetch timer would imply near-real-time processing the backend
doesn't provide; manual "Refresh" buttons instead, consistent with this project's own
prior UI-truthfulness correction. Job-report correlation is done client-side by
matching `job_id` (the two resources are deliberately decoupled on the backend) — a
completed job whose report hasn't appeared in a stale reports list yet gets an honest
message and a refresh action, not a crash. Null report fields render the exact same
"Unavailable" treatment already used on `/portfolio`'s `TradeImpactPreview`. Design/UX
skills loaded and applied before implementation (`frontend-design`, `ui-ux-pro-max`,
`web-design-guidelines`, `vercel-composition-patterns`, `vercel-react-best-practices`,
`bencium-controlled-ux-designer`) — applied as accessibility/composition/performance
guidance since this extends an already-established design system rather than making a
new aesthetic decision; every visual choice reuses an existing component or class
already shipped on `/portfolio`. Evidence:
[P5_RESEARCH_DESK_FRONTEND_VERIFICATION.md](P5_RESEARCH_DESK_FRONTEND_VERIFICATION.md).
**This gives every one of Phase 5's six backend routes (PRs #69-#75, seven stacked,
independently-CI-green, none merged) a working frontend surface for the first time.**
Still open: the actual TradingAgents multi-agent framework's point-in-time data
adaptation, personalized-brief automatic refresh, and everything in Phase 6 (Kronos
Forecast Lab) and Phase 7 (release hardening), both entirely unstarted.

[PR 74](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/74) is ready
with all CI checks green: TradingAgents (`TauricResearch/TradingAgents`, Apache-2.0,
pinned `v0.7.1`) added as a second, **optional, heavier** synthesis backend alongside
PR #72's single-call one. User explicitly chose to proceed with the real multi-agent
framework after discussing cost/quality trade-offs, rather than stop at PR #72's
simpler backend. Default backend stays `"simple"` — this unit changes no existing
behavior unless an operator sets `research_synthesis_backend = "tradingagents"`. The
field mapping (`bull_case`/`bear_case`/`synthesis`/`risks`/`backend_detail`) uses the
exact `final_state` keys read directly from TradingAgents' own `trading_graph.py`
source, not guessed. Pointed at the same local Ollama model (`qwen3:14b`) via its
native `ollama` provider support — stays fully cost-free. The heavy dependency
(LangGraph + every provider SDK it supports) lives only in a new, separate
`requirements-research.txt`, never `requirements.txt`; the service module does a lazy
import, confirmed to succeed in this environment where the real package is genuinely
not installed. No trade-execution risk — `propagate()`'s return value is only ever
read and stored, never passed to any order-placement path; there is no such path to
disable in how this integration calls the library. Evidence:
[P5F_TRADINGAGENTS_VERIFICATION.md](P5F_TRADINGAGENTS_VERIFICATION.md); design:
[P5F_TRADINGAGENTS_CONTRACT.md](P5F_TRADINGAGENTS_CONTRACT.md). **Explicitly deferred
and disclosed**: point-in-time data adaptation (still uses TradingAgents' own default
Yahoo/SEC EDGAR/FRED vendors, not Sentinel's cached data — a separate, larger
integration), and isolating long-running research jobs onto their own scheduled cycle
(a job on this backend can delay the rest of a cycle behind it — operators enabling it
should set `scheduled_research_job_limit` very low, e.g. `1`). A real end-to-end
`propagate()` call against local Ollama was not run as part of verification — plausibly
tens of minutes per job; verification relied on the package's own source plus a fully
mocked test suite. Full suite hit a transient Windows pytest-temp-dir
`PermissionError` unrelated to this code (same class as `test_watchlists.py`'s two
long-documented errors); a fresh `--basetemp` cleared it, incidentally clearing those
two as well. **This closes the currently-scoped Phase 5 pass** — PRs #69 through #74,
six stacked, independently-CI-green, none merged. Still open: point-in-time data
adaptation for TradingAgents, personalized-brief automatic refresh, and a frontend for
any of Phase 5's six new routes.

[PR 73](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/73) is ready
with all CI checks green: `GET /research/briefs`/`GET /research/briefs/{brief_id}`,
closing out every named route in roadmap Phase 5 section 5.4
(`/research/jobs`, `/research/filings`, `/research/reports`, `/research/briefs`).
**Aggregation only** — a brief pairs each symbol a user currently holds with the most
recent completed report for it, or `null`; no new job creation, no local-model calls,
no new synthesis. **Idempotent by design**: a `(user_id, brief_date)` unique
constraint at the DB level, and `build_daily_brief` returns the existing brief
unchanged on a second same-day call even if a newer report has since appeared — a
brief is a snapshot at build time, not a live view, proven by a test that rebuilds
after a second, newer report exists and confirms the brief still points at the
original one. `build_daily_briefs`'s bound is enforced by a `NOT IN` subquery at the
database level, not by fetching-then-slicing in Python, proven by a test that seeds
more eligible users than the limit. Wired into the scheduler as a seventh step;
extended the one pre-existing scheduler test that doesn't mock every step (already
touched once in PR #71 for the sixth step) to also mock this one. Evidence:
[P5E_RESEARCH_BRIEFS_VERIFICATION.md](P5E_RESEARCH_BRIEFS_VERIFICATION.md); design:
[P5E_RESEARCH_BRIEFS_CONTRACT.md](P5E_RESEARCH_BRIEFS_CONTRACT.md). **This closes the
currently-scoped Phase 5 slice started with PR #69** — SEC EDGAR filings (PR #69) →
job intake (PR #70) → bounded worker with real data gathering (PR #71) → local-model
synthesis via Ollama (PR #72) → personalized daily briefs (PR #73) — five stacked,
independently-CI-green PRs, none merged. Still fully open for a future pass: the
actual TradingAgents multi-agent framework (every synthesis step shipped so far is a
single direct local-model call, not that), automatic refresh of a stale report feeding
into a brief, and a frontend for any of Phase 5's five new routes.

[PR 72](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/72) is ready
with all CI checks green: the user's explicit choice to use a **local, cost-free model
via Ollama** (`qwen3:14b`, already installed and running on this machine) instead of a
paid API or the TradingAgents framework itself, to fill in the `bull_case`/`bear_case`/
`synthesis`/`risks`/`model_version`/`prompt_version` fields PR #71's worker always left
`null`. Gated behind a new `research_synthesis_enabled` setting, default `false`, so CI
(no Ollama there) and every pre-existing test stay completely unaffected — one test
explicitly proves the local model is never called while the flag is at its default. A
failed or skipped synthesis call never fails the job, same resilience philosophy as the
two existing data sources (SEC fundamentals/filings) — a `local_llm` entry just records
`"unavailable"` in `sources` instead. `_parse_sections` (plain-text section splitting,
not JSON — small local models aren't reliable JSON producers) was independently
verified against four hand-built reference vectors before implementation: well-formed,
a missing marker, markers out of the instructed order, and no markers at all — all four
matched. No schema change, no new migration. Evidence:
[P5D_RESEARCH_SYNTHESIS_VERIFICATION.md](P5D_RESEARCH_SYNTHESIS_VERIFICATION.md);
design: [P5D_RESEARCH_SYNTHESIS_CONTRACT.md](P5D_RESEARCH_SYNTHESIS_CONTRACT.md). **This
closes out the currently-scoped slice of Phase 5** — every job created via `POST
/research/jobs` now, once an operator turns the new flag on locally with Ollama
running, produces a real (if basic) equity research note end to end: data gathering →
local-model synthesis → a readable report via `GET /research/reports`. Still fully open
for a future pass: the actual TradingAgents multi-agent framework (this unit is a
single direct model call, not that), personalized daily briefs, and
`/research/briefs/*`.

[PR 71](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/71) is ready
with all CI checks green: the bounded worker that actually drains the job queue PR #70
built intake for. **No TradingAgents or LLM integration** — the report produced only
documents which already-existing data sources (SEC fundamentals, SEC filings) were
available for that symbol; every AI-synthesis field (`bull_case`/`bear_case`/
`synthesis`/`risks`/`model_version`/`prompt_version`) stays `null`, deliberately
deferred to its own later unit that needs separate scoping (model choice, cost, prompt
versioning). Wired into the existing single scheduled-jobs cycle as a sixth step, same
try/except/rollback/log shape as the other five, bounded by a new
`scheduled_research_job_limit` setting (default 5) — this is the actual "bounded" in
"bounded worker." New `GET /research/reports`/`GET /research/reports/{report_id}`,
ownership-scoped the same way as the job routes. Evidence:
[P5C_RESEARCH_WORKER_VERIFICATION.md](P5C_RESEARCH_WORKER_VERIFICATION.md); design:
[P5C_RESEARCH_WORKER_CONTRACT.md](P5C_RESEARCH_WORKER_CONTRACT.md). Pre-emptively bumped
the two Postgres-only "fresh install reaches head" assertions again, same class of fix
as the prior two units. **Self-caught review mistake, disclosed in the verification
doc**: removed a defensive guard from the implementation as apparent dead code without
checking why it was there first; it was the deliberate fix for a pre-existing scheduler
test (`test_phase2_controls.py`) whose fake `Session` double only implements
`rollback()`. Caught by the full suite, fixed properly by extending that test's own
mocks to cover the new step instead of restoring the guard — keeps the worker code free
of test-only defensive logic. Still fully open for Phase 5: the actual TradingAgents/LLM
synthesis step, personalized daily briefs, and `/research/briefs/*`.

[PR 70](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/70) is ready with
all CI checks green: the job-queue **intake** surface named in roadmap Phase 5 section
5.4 — `POST /research/jobs`, `GET /research/jobs`, `GET /research/jobs/{job_id}`,
`POST /research/jobs/{job_id}/cancel`. **No worker exists yet** — a job only ever reaches
`queued` (on creation) or `cancelled` (via cancel) from this code; `running`/`completed`/
`failed` are already declared in the DB check constraint so the worker unit that comes
next needs no further migration. Ownership-scoped lookups mirror `GET
/orders/{order_id}`'s own pattern (another user's job 404s exactly like a nonexistent
one, never a distinguishing 403); cancel mirrors `order_book.cancel_order`'s
row-locking + state-check + 409. A 10-job cap (`queued`+`running`) guards against
unbounded growth before a worker drains the queue. Evidence:
[P5B_RESEARCH_JOBS_VERIFICATION.md](P5B_RESEARCH_JOBS_VERIFICATION.md); design:
[P5B_RESEARCH_JOBS_CONTRACT.md](P5B_RESEARCH_JOBS_CONTRACT.md). **Learned from PR #69's
own CI-caught breakage**: grepped the repo for the previous Alembic head string before
shipping this time and pre-emptively bumped the same two Postgres-only "fresh install
reaches head" assertions; the watchlist-migration isolation proof PR #69 pinned to its
own revision needed no further change, confirming that fix actually generalizes. CI's
`browser` job hit two *different* flakes across two reruns (the known
`test_p3b_watchlists_ui` stale-element issue, then a separate DOM-update race in
`test_p3a_indicators_ui`'s MACD warm-up check) — read each failure log before rerunning
rather than assuming either was the other; both passed clean on their own by the third
attempt, and neither touches code this PR changed. Still fully open for Phase 5: the
async job queue's actual consumer (the bounded TradingAgents worker), report synthesis,
personalized daily briefs, and `/research/reports`/`/research/briefs`.

[PR 69](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/69) is ready with all
CI checks green: the first unit of roadmap Phase 5 (AI Research Desk), redirected into by the
user after PR #68 closed out Phase 4 and the Phase 3 core chart checklist. SEC EDGAR
*fundamentals* (XBRL company facts) already shipped in an earlier phase via
`get_sec_company_fundamentals`, feeding `GET /market/research/{symbol}` — this PR adds the
genuinely missing piece, the **filings index** (10-K/10-Q/8-K, dates, accession numbers, a
direct document link), a different SEC endpoint (`submissions/CIK{cik}.json`, not
`companyfacts`). New `app/services/sec_service.get_sec_company_filings`, a new
`market_filings_cache` table + migration, and the first route under a new `/research` prefix
(`GET /research/filings/{symbol}`) — the prefix the rest of Phase 5's API surface
(jobs/reports/briefs) will use later. Evidence:
[P5A_SEC_FILINGS_VERIFICATION.md](P5A_SEC_FILINGS_VERIFICATION.md); design:
[P5A_SEC_FILINGS_CONTRACT.md](P5A_SEC_FILINGS_CONTRACT.md), with hand-built reference vectors
re-derived independently before implementation. **CI caught two real cross-file consequences
the scoped unit's own tests couldn't**, both only visible against the real disposable
Postgres CI spins up (skipped locally without `AUDIT_DATABASE_URL`): three tests hardcoded the
previous Alembic head (`b73e2d9f6a10`) and needed updating to the new one
(`e1a7c3b5d820`); and `test_watchlist_migration_preserves_baseline_and_app_grants` conflated
"the watchlist migration's own revision" with "whatever the current head is" — true only
because the watchlist migration happened to be the tip when that test was written. Fixed by
pinning that proof to the watchlist migration's own revision instead of `head`, since that is
what the test actually proves. Still fully open for Phase 5: the async job queue, the bounded
TradingAgents worker, report synthesis, personalized daily briefs, and every other named
`/research/*` route (`jobs`, `reports`, `briefs`) — this unit is pure data-source groundwork,
nothing more.

[PR 68](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/68) is ready with all
CI checks green: a new "Custom risk scenarios" card on `/portfolio`, calling
`POST /risk/scenarios` (PR #67) on form submit. Evidence:
[P4G_RISK_SCENARIOS_FRONTEND_VERIFICATION.md](P4G_RISK_SCENARIOS_FRONTEND_VERIFICATION.md).
The first **dynamic-list** form on this page — the user adds/removes 1-20 shock rows before
submitting, clamped at both bounds to match the backend's own limits. Mutation-on-submit only,
mirroring the "Trade impact preview" pattern (PR #61) — never fetches automatically. Reuses the
existing `impactMoney`/`impactWeightChange` helpers rather than duplicating them, so `loss_pct`
correctly renders a gain's negative-loss sign via `formatSignedPercent`. `shock_pct` is sent as
the raw string the user typed, not re-parsed and reformatted — asserted directly against the
exact request payload. **With this PR, every backend endpoint shipped this session now has
some frontend surface, including the full Phase 4.4 Risk Lab custom-shock flow.** Still open:
interest-rate shock assumptions and historical crisis-style scenarios (each needs its own
model, not built here), and a broad-market/"all" target type (already covered by the existing
fixed `broad_market_selloff` scenario). No manual browser/visual check was performed, disclosed
explicitly.

[PR 67](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/67) is ready with all
CI checks green: `POST /risk/scenarios`, the custom security/sector shock builder named in
roadmap Phase 4.4's Risk Lab ("Custom simultaneous security or sector shocks") and section
4.5's API list — distinct from the fixed three-scenario `stress_scenarios` already in
`GET /portfolio/risk-metrics` (PR #51). Evidence:
[P4G_RISK_SCENARIOS_VERIFICATION.md](P4G_RISK_SCENARIOS_VERIFICATION.md). Design:
`docs/P4G_RISK_SCENARIOS_CONTRACT.md`. Matching shocks apply multiplicatively, in request
order, with one cent-quantization per security after all matches — not summed percentages
(which could push a value below `-100%`) and not one rounding per shock (which would compound
error); a dedicated test distinguishes the correct multiplicative result from what a naive
summed-percentage implementation would have produced. Does not assume every scenario is a
loss — a positive `shock_pct` correctly produces a negative `loss` (a gain), tested
explicitly. Never writes to the database, verified by the same book-fingerprint pattern the
trade-impact preview already established. One `browser` CI flake hit on this PR's first run —
the same already-documented `test_p3b_watchlists_ui.py` `StaleElementReferenceException`,
confirmed via the actual log, unrelated, reran clean. Still open on the same Risk Lab list:
interest-rate shock assumptions and historical crisis-style scenarios (each needs its own
model), a broad-market/"all" target type (already covered by the existing fixed scenario), and
any frontend rendering for this new endpoint.

[PR 66](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/66) is ready with all
CI checks green: trade execution markers and open-order price lines added to the daily history
chart, closing the roadmap's "Trade execution markers on historical charts," "Price levels for
open limit orders," and "Plot fills and active orders on charts" lines. Evidence:
[P3_CHART_TRADE_MARKERS_VERIFICATION.md](P3_CHART_TRADE_MARKERS_VERIFICATION.md). Design:
`docs/P3_CHART_TRADE_MARKERS_DESIGN.md`. No new backend endpoint — reuses the existing
`fetchTrades`/`fetchOrders`, filtered client-side to the shown symbol. Both overlays are
duplicated across all three price series (candlestick/line/area, PR #62) as a deliberate hedge
against an unverified library assumption about whether hiding a series also hides its own
decorations. Overlay updates sit in their own effects, separate from the candle `setData` path,
so a trade/order refresh never replots prices — a genuine improvement over what I asked for.
Worth recording: Grok caught and self-corrected a real risk in my own task wording before
writing any code — I described `createSeriesMarkers` as "a top-level function import," which
would have conflicted with this file's existing lazy `dynamic import("lightweight-charts")`
pattern that `DailyHistoryLifecycle.test.tsx` depends on staying gated; Grok used the
already-dynamically-imported module object instead, matching how every other chart-type
constant in this file is already referenced. A trade's UTC date is matched directly against
loaded candle dates (not exchange-calendar-aware) — a documented, deliberate simplification for
a visual overlay, not a financial calculation; a non-matching trade is silently skipped, tested
explicitly. **With this PR, every item on the roadmap's Phase 3 "Core chart features" list
(section 3.1) and "Order lifecycle and chart integration" (section 3.3, the charting half) is
closed except user-configurable indicator parameters beyond period/signal-period** (already
largely satisfied — period is configurable for every indicator that has one; MACD's fast/slow
and Bollinger's band width are deliberately fixed, documented design choices from their own
original contracts, not gaps). No manual browser/visual check was performed, disclosed
explicitly.

[PR 65](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/65) is ready with all
CI checks green: the daily history chart's range/indicator/period/chart-type now persist in
`localStorage`, closing the roadmap's "Persisted chart preferences" line. Evidence:
[P3_CHART_PREFERENCES_VERIFICATION.md](P3_CHART_PREFERENCES_VERIFICATION.md). The selected
symbol/series is deliberately not persisted — only display preferences. Every stored field is
individually validated against its own allowed-value set before being trusted; a corrupted or
stale entry degrades field-by-field to the existing hardcoded default, never throws. Both
load/save are best-effort (`try`/`catch`), so a private window or full storage quota never
breaks the chart. A test-mode-only cleanup on unmount prevents preference leakage into
`DailyIndicators.test.tsx`, which also renders `DailyHistory` across many of its own tests and
was correctly left outside this unit's edit scope — verified by running the full suite, not
just the two files this unit directly touched. `historyData.ts` is byte-identical. One
`browser` CI flake hit on this PR's first run — the same already-documented
`test_p3b_watchlists_ui.py` `StaleElementReferenceException`, confirmed via the actual log,
unrelated, reran clean. No manual browser/visual check was performed, disclosed explicitly.
With this PR, every item on the roadmap's Phase 3 "Core chart features" list is closed except
trade execution markers and price levels for open limit orders (both need live order/trade
data wired into the chart, a separate, larger unit) and user-configurable indicator parameters
beyond period/signal-period.

[PR 64](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/64) is ready with all
CI checks green: the four new history timeframes (`1m`/`3m`/`6m`/`all`, backend PR #63) wired
into the daily history chart's range `<select>`. Evidence:
[P3_HISTORY_TIMEFRAMES_FRONTEND_VERIFICATION.md](P3_HISTORY_TIMEFRAMES_FRONTEND_VERIFICATION.md).
`HistoryRange` widened from two to six literals; `readHistoryRange`'s `"2y"` fallback and the
form's default range are both unchanged; `historyData.ts` is byte-identical (pure option-list
wiring). **This closes the full timeframe scope — backend (PR #63) and frontend (this unit) —
of the roadmap's Phase 3 line "Historical timeframes: 1M, 3M, 6M, 1Y, 2Y, and All."** Combined
with PRs #46 (Bollinger frontend) and #62 (chart modes), the "SMA, EMA, Bollinger Bands, RSI,
and MACD" indicator line, the "Candlestick, line, and area chart modes" line, and now the
timeframes line are all fully closed end-to-end. Still open on that same Phase 3 section: a
volume-only toggle/crosshair inspection details, trade execution markers, price levels for
open limit orders, persisted chart preferences, and user-configurable indicator parameters
beyond period/signal-period. No manual browser/visual check was performed, disclosed
explicitly.

[PR 63](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/63) is ready with all
CI checks green: 1m/3m/6m/all history timeframes added to
`app/services/market_history.py`'s `SUPPORTED_RANGES` (backend only), closing the remaining
timeframe scope of the roadmap's Phase 3 line "Historical timeframes: 1M, 3M, 6M, 1Y, 2Y, and
All." Evidence:
[P3_HISTORY_TIMEFRAMES_VERIFICATION.md](P3_HISTORY_TIMEFRAMES_VERIFICATION.md). Design:
`docs/P3_HISTORY_TIMEFRAMES_CONTRACT.md`. `market_indicators.py` inherits the new tokens
automatically (already a black-box caller of `read_symbol_history`);
`performance_service.py`'s own separate, unrelated range concept is untouched. `"all"` is a
fixed `1900-01-01` sentinel, deliberately relying on `_coverage`'s existing `try/except
ValueError` fallback (already written generally, not for this unit specifically) rather than
new special-case code — verified directly by a test asserting `coverage_status ==
"not_verified"` for that window. Worth recording: running the **full** backend suite (not just
the scoped test file) surfaced one real failure — `test_market_indicators.py` had its own
hardcoded copy of the old `"range must be 1y or 2y."` error string, in a test file outside this
unit's Grok task's edit scope; fixed directly as a trivial one-line consequence of the
already-reviewed, correct message change, not re-delegated. Backend only — the frontend
`HistoryRange` type and the range `<select>` in `DailyHistory.tsx` remain `1y`/`2y` only;
wiring the four new tokens into the frontend is a separate, following unit.

[PR 62](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/62) is ready with all
CI checks green: line and area chart modes added to the daily history chart — candlestick was
the only mode before this unit. Evidence:
[P3_CHART_MODES_FRONTEND_VERIFICATION.md](P3_CHART_MODES_FRONTEND_VERIFICATION.md). Closes the
roadmap's Phase 3 line "Candlestick, line, and area chart modes." All three price series are
created once per chart mount and toggled via `visible`, never recreated on a mode switch; the
chart-type `<select>` lives outside the existing symbol/range/indicator form and its own
`onChange` never calls `handleSubmit` or `refetch` — proven directly by a test cycling through
all three modes and asserting no additional network call or chart recreation.
`frontend/src/components/historyData.ts` (data parsing) is byte-identical — pure rendering,
no change to how candles or indicators are parsed. One `browser` CI flake hit on this PR's
first run — the same already-documented `test_p3b_watchlists_ui.py`
`StaleElementReferenceException`, confirmed via the actual log, unrelated to chart rendering,
reran clean. No manual browser/visual check was performed, disclosed explicitly. Still open on
the same roadmap line: historical timeframes beyond `1y`/`2y` (1M/3M/6M/All), trade execution
markers, price levels for open orders, persisted chart preferences, and user-configurable
indicator parameters beyond period/signal-period.

[PR 61](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/61) is ready with all
CI checks green: a new "Trade impact preview" card on `/portfolio`, calling
`POST /portfolio/trade-impact` (PR #54) on form submit. Evidence:
[P4F_TRADE_IMPACT_PREVIEW_FRONTEND_VERIFICATION.md](P4F_TRADE_IMPACT_PREVIEW_FRONTEND_VERIFICATION.md).
The first **mutation**-driven Phase 4 frontend unit this session — every prior card
(allocation, attribution, risk metrics) fetches automatically on page load; this one previews
a hypothetical trade only when the user submits the form, and never navigates or clears on
success. Mirrors the existing `CashPanel` mutation pattern and `QuickTradePanel`'s buy/sell
toggle for consistency. Warnings render without hiding the numeric result, faithfully matching
the backend's own "never a rejection" design (tested with a deliberately infeasible trade going
to a negative cash balance and a `106.25%` weight). A client-side `symbol_position_value` delta
is computed from `after - before` since the real response has no such field in `changes`.
Explicitly verified the submit calls only `previewTradeImpact` and nothing else — no real
trade, cash movement, or other mutation is ever triggered by this preview, and every other
card's read-only query call count is confirmed unchanged by the submit.

**With this PR, every Phase 4 backend endpoint shipped this session — performance (PRs
#37-#41, #43), allocation (#45), attribution (#53), risk-metrics (#47-#52), and trade-impact
(#54) — now has some frontend surface on `/portfolio`** (PRs #55-#61). No manual browser/visual
check was performed across any of them, disclosed explicitly in each one's own verification
doc. Open, unstarted: a `1y`/`2y` range selector for the performance/risk-metrics cards
(currently hardcoded); `POST /risk/scenarios` (Phase 4.4's full custom-shock Risk Lab, backend
and frontend both); Phase 5 (AI Research Desk, deferred per the user's own decision), Phase 6
(Forecast Lab), Phase 7 (release hardening); and the many still-open Phase 3 chart items (chart
modes beyond candlestick, timeframes beyond 1y/2y, trade execution markers, price levels for
open orders, persisted chart preferences, user-configurable indicator parameters).

[PR 60](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/60) is ready with all
CI checks green: a `risk_contributions` table added inside the existing "Risk metrics (1y)"
card (no new card) — the **last** of the four list-shaped risk-metrics fields. Evidence:
[P4D_RISK_CONTRIBUTIONS_FRONTEND_VERIFICATION.md](P4D_RISK_CONTRIBUTIONS_FRONTEND_VERIFICATION.md).
`risk_contributions`' type widened from the placeholder `unknown[] | null` to a proper
`RiskContribution[] | null` — **every field in `RiskMetricsResponse` is now properly typed**,
none loosely typed. `weight_pct`/`risk_contribution_pct` both use plain `formatPercent` (genuine
non-negative percentages, unlike `correlation`/`portfolio_beta`'s unitless ratios elsewhere on
this card). **With this PR, every field `GET /portfolio/risk-metrics` returns has frontend
rendering** — seven scalar stats plus `stress_scenarios`, `correlations`, and
`risk_contributions`, across PRs #57-#60. Combined with PRs #55/#56 (allocation/attribution),
all of this session's Phase 4 analytics backend work now has some frontend surface, except
`POST /portfolio/trade-impact` (a form, not a read-only card — a different kind of frontend
work, still open) and a `1y`/`2y` range selector for the risk metrics card (currently hardcoded
to `1y`). No manual browser/visual check was performed across any of PRs #55-#60, disclosed
explicitly in each one's own verification doc.

[PR 59](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/59) is ready with all
CI checks green: a `correlations` table added inside the existing "Risk metrics (1y)" card (no
new card), rendering the per-pair correlation list from `GET /portfolio/risk-metrics` (PR #50).
Evidence:
[P4D_CORRELATIONS_FRONTEND_VERIFICATION.md](P4D_CORRELATIONS_FRONTEND_VERIFICATION.md).
`correlations`' type widened from the placeholder `unknown[] | null` to a proper
`RiskCorrelation[] | null`; `risk_contributions` is now the **only** remaining untouched
placeholder field. `correlation` renders as a plain decimal ratio (same convention as
`portfolio_beta`), never run through a percent formatter — tested explicitly. A pair-level
`null` (insufficient common price history for that specific pair) is handled independently of
the whole-field `null` (fewer than two held symbols), both exercised in one response/test.
Three of four list-shaped risk-metrics fields now wired; only `risk_contributions` remains,
alongside `POST /portfolio/trade-impact`'s own still-unwired UI. No manual browser/visual check
was performed, disclosed explicitly.

[PR 58](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/58) is ready with all
CI checks green: a `stress_scenarios` table added inside the existing "Risk metrics (1y)" card
(no new card), rendering the fixed three-scenario list from `GET /portfolio/risk-metrics` (PR
#51). Evidence:
[P4D_STRESS_SCENARIOS_FRONTEND_VERIFICATION.md](P4D_STRESS_SCENARIOS_FRONTEND_VERIFICATION.md).
`stress_scenarios`' type widened from the deliberately-loose placeholder `unknown[] | null` to
a proper `StressScenario[] | null`; `correlations`/`risk_contributions` stay as planned future
slices. `shock_pct` renders as a plain literal (never run through `formatPercent` — it's an
input constant, not a computed magnitude); `loss_pct` reuses the existing non-negative
`formatRiskPercent` helper; `affected_symbol` appears only on the
`single_security_worst_holding` row, tested explicitly against leaking into the other two.
Second of three list-shaped risk-metrics fields now wired (`correlations`/`risk_contributions`
remain open), alongside `POST /portfolio/trade-impact`'s own still-unwired UI. One `browser` CI
flake hit on this PR's own first run — the same already-documented
`test_p3b_watchlists_ui.py` `StaleElementReferenceException`, confirmed via the actual log,
unrelated, reran clean. No manual browser/visual check was performed, disclosed explicitly.

[PR 57](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/57) is ready with all
CI checks green: a new "Risk metrics (1y)" card on `/portfolio`, additive on top of PRs #55/#56,
rendering the seven **scalar** fields of `GET /portfolio/risk-metrics` (historical volatility,
max drawdown, beta, 95/99% VaR, 95/99% Expected Shortfall). Evidence:
[P4D_PORTFOLIO_RISK_METRICS_FRONTEND_VERIFICATION.md](P4D_PORTFOLIO_RISK_METRICS_FRONTEND_VERIFICATION.md).
Each field's visibility is keyed off its own `null` value independently, **not** the
response's overall `status` — unlike allocation/attribution's all-or-nothing `status`,
risk-metrics' scalar fields each carry their own independent null-gating threshold on the
backend (e.g. volatility needs 2 returns, 99% VaR needs 100), so a real account commonly has
some fields present and others `null` at once; proven directly by a test with a mixed response.
`portfolio_beta` renders as a plain ratio, never passed through a percent formatter (tested
explicitly — the other six fields are genuine non-negative loss percentages, so they do use
`formatPercent`). The three list-shaped fields (`correlations`, `stress_scenarios`,
`risk_contributions`) remain separate, later frontend slices, as does any range selector
(hardcoded to `1y` here) and `POST /portfolio/trade-impact`'s own UI. No manual browser/visual
check was performed, disclosed explicitly. (One `browser` CI flake hit on PR #56's own doc-only
commit — the same already-documented `test_p3b_watchlists_ui.py` `StaleElementReferenceException`
— confirmed via the actual log, unrelated, reran clean.)

[PR 56](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/56) is ready with all
CI checks green: a new "P&L attribution" card on `/portfolio`, additive on top of PR #55's
Sector allocation card, rendering `GET /portfolio/attribution` (PR #53) — realized/unrealized/
total P&L and contribution percentage per security and sector. Evidence:
[P4E_PORTFOLIO_ATTRIBUTION_FRONTEND_VERIFICATION.md](P4E_PORTFOLIO_ATTRIBUTION_FRONTEND_VERIFICATION.md).
Uses `formatSignedPercent`, not `formatPercent`, for `pnl_contribution_pct` — it is signed and
unbounded (a loss contributes negatively, a large gain can exceed 100%), tested directly
against both edge cases from the real contract reference (`"+130.31%"`/`"-30.31%"`), scoped to
each security's own table row. Existing Sector allocation card untouched. Still open:
rendering `GET /portfolio/risk-metrics` (nine metrics) and `POST /portfolio/trade-impact`, each
its own future frontend slice; no manual browser/visual check was performed, disclosed
explicitly.

[PR 55](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/55) is ready with all
CI checks green: a new "Sector allocation" card on the `/portfolio` page, rendering
`GET /portfolio/allocation` (PR #45) — cash plus each sector's dollar value and weight
percentage. Evidence:
[P4C_PORTFOLIO_ALLOCATION_FRONTEND_VERIFICATION.md](P4C_PORTFOLIO_ALLOCATION_FRONTEND_VERIFICATION.md).
This is the first frontend rendering of any of this session's Phase 4 analytics work —
allocation, `GET /portfolio/risk-metrics` (nine metrics), `GET /portfolio/attribution`, and
`POST /portfolio/trade-impact` all had zero UI before this PR. New types correctly model the
backend's decimal-text convention (`string | null`, not the older `PortfolioResponse`'s plain
numbers), converted with `Number(text)` immediately before display — the right level of rigor
for a read-only table, not `historyData.ts`'s stricter chart-precision validation. Distinguishes
loading, `status === "incomplete"` (an explicit unavailable message, no percentage rendered),
and a complete-but-zero-sectors case (cash row still shown, a distinct "no sector exposure"
note) rather than conflating "unavailable" with "genuinely zero." Additive only — no existing
section of the Portfolio page was touched. Still open: rendering risk-metrics, attribution, and
trade-impact, each its own future frontend slice; no manual browser/visual check was performed,
disclosed explicitly.

[PR 54](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/54) is ready with all
CI checks green: `POST /portfolio/trade-impact`, the first slice of Phase 4.3's "signature
feature," Trade Impact Preview. Evidence:
[P4F_TRADE_IMPACT_PREVIEW_VERIFICATION.md](P4F_TRADE_IMPACT_PREVIEW_VERIFICATION.md). Design:
`docs/P4F_TRADE_IMPACT_PREVIEW_CONTRACT.md`. Cash, position-value, and weight before/after only
for one hypothetical trade; portfolio-volatility impact, VaR impact, and sector-exposure
before/after (all named in the roadmap's own illustrative table) remain separate, later slices.
Never writes to the database — no `Order`/`Trade`/`Holding`/`LedgerEntry` row is created or
mutated, verified by a test-level book fingerprint before/after the call. Warnings
(`insufficient_buying_power`/`insufficient_shares`) never short-circuit the computation — the
preview always returns the real, unclamped numbers, including a negative cash balance or a
weight over 100%, consistent with the roadmap's own "non-binding" framing. Worth recording: I
caught and corrected **three** real inconsistencies in my own contract's computation rules,
across two rounds with Grok, before any implementation code existed for the third — a wrong
account-total formula missing an offsetting leg, a stray clamp note contradicting the
contract's own no-clamping design, and an incomplete-case nulling rule stricter than the
`GET /portfolio/allocation` precedent it claimed to follow; Grok's first attempt caught all
three by actually computing the numbers rather than trusting the written formulas, flagged
each one explicitly instead of guessing, and the second (corrected) attempt implemented
cleanly. With this PR, every roadmap route named in section 4.5 is shipped at least a first
slice, except `POST /risk/scenarios` (Phase 4.4's full custom-shock Risk Lab, distinct from the
fixed three-scenario `stress_scenarios` already in `GET /portfolio/risk-metrics`), which
remains open and unstarted.

[PR 53](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/53) is ready with all
CI checks green: a new `GET /portfolio/attribution` route — the last remaining named route from
the roadmap's section 4.5 API list (`/performance`, `/allocation`, `/risk-metrics` were all
already shipped). Evidence:
[P4E_PORTFOLIO_ATTRIBUTION_VERIFICATION.md](P4E_PORTFOLIO_ATTRIBUTION_VERIFICATION.md). A new,
isolated `app/services/portfolio_attribution.py`, structurally a sibling of
`portfolio_allocation.py`: reuses the already-published `realized_pnl`/`unrealized_pnl`/
`total_pnl` fields `build_portfolio_response` already produces (PR #42) — no new P&L
arithmetic — plus the existing `sector_classifier.py`. `pnl_contribution_pct` is deliberately
not clamped to `[0, 100]`: a losing position contributes a negative share, and a position whose
gain exceeds the account's net total contributes over 100%, both correct and explicitly tested
against the real route. Distinct from `GET /portfolio/risk-metrics`'s variance-based
`risk_contributions` (PR #52) — dollar P&L attribution and risk attribution answer different
questions and share no implementation. With this PR, every route named in roadmap section 4.5
is shipped. Still open: `POST /portfolio/trade-impact` (Phase 4.3's Trade Impact Preview) and
`POST /risk/scenarios` (Phase 4.4's full custom-shock Risk Lab, as opposed to the fixed
three-scenario `stress_scenarios` already shipped in `GET /portfolio/risk-metrics`) — both
separate, larger, unstarted units. Phase 4 (performance, allocation, and risk analytics) is now
substantially complete at the API level; the frontend has not yet rendered any of
risk-metrics', allocation's, or attribution's data.

[PR 52](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/52) is ready with all
CI checks green: `risk_contributions`, the sixth and final slice added to
`GET /portfolio/risk-metrics` (additive on top of PRs #47-#51). Evidence:
[P4D_PORTFOLIO_RISK_CONTRIBUTION_VERIFICATION.md](P4D_PORTFOLIO_RISK_CONTRIBUTION_VERIFICATION.md).
Design: `docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 6. Decomposes portfolio variance
across held, priced securities via a full covariance matrix (each off-diagonal pair over its
own common usable days — the same simplification correlation already made; each diagonal entry
over that security's own full usable-day variance, not the pair-restricted window). Null on any
missing matrix entry, non-positive portfolio variance, an incomplete allocation, or zero priced
holdings; otherwise every `risk_contribution_pct` sums to exactly `"100.0000"` by construction
(Euler's theorem). Worth recording: I caught a real arithmetic error in my own contract's first
worked reference before any implementation code existed — it mistakenly reused the
pair-restricted variance for a security's diagonal instead of that security's own full-series
variance. Grok's first attempt independently computed both and stopped rather than guessing,
which is what surfaced it; I re-derived both figures myself, corrected the contract, and
relaunched. With this PR, **every one of the roadmap's nine Phase 4.2 "Quantitative risk
engine" metrics now has some form shipped** (concentration via PR #45; historical volatility,
max drawdown, beta, historical VaR, Expected Shortfall, correlation, stress-test loss, and risk
contribution via PRs #47-#52). `GET /portfolio/attribution` (the remaining named route in
roadmap section 4.5) and the full custom-shock Risk Lab backend (`POST /risk/scenarios`, Phase
4.4) remain open, unstarted.

[PR 51](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/51) is ready with all
CI checks green: `stress_scenarios`, the fifth slice added to `GET /portfolio/risk-metrics`
(additive on top of PRs #47-#50). Evidence:
[P4D_PORTFOLIO_STRESS_TEST_VERIFICATION.md](P4D_PORTFOLIO_STRESS_TEST_VERIFICATION.md). Design:
`docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 5. A third black-box call,
`build_allocation_response` (first use of `portfolio_allocation.py` from this module), backs
three fixed, non-configurable scenarios: a 10% broad market selloff, a 25% Technology-sector
selloff (filtered by each security's already-classified sector, no reclassification), and a 30%
shock to the single largest priced holding (ties broken by ascending symbol). Cash is never
shocked. `stress_scenarios` is `null` only when the underlying allocation is incomplete; a
scenario with nothing to shock (no Technology exposure, or nothing priced at all) still reports
a real measured `"0.00"`, correctly distinguished from the incomplete-allocation null case. All
nine of the roadmap's Phase 4.2 metrics now have some form closed except risk contribution,
which needs a full covariance-matrix risk model built on top of this session's correlation work
— a separate, larger future unit. `POST /risk/scenarios` (Phase 4.4's custom-shock Risk Lab
backend) also remains open, unstarted.

[PR 50](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/50) is ready with all
CI checks green: `correlations`, the fourth slice added to `GET /portfolio/risk-metrics`
(additive on top of PRs #47-#49). Evidence:
[P4D_PORTFOLIO_CORRELATION_VERIFICATION.md](P4D_PORTFOLIO_CORRELATION_VERIFICATION.md). Design:
`docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 4. The first metric in this response not
derivable from `build_performance_response` alone: a second black-box call,
`build_portfolio_response`, reads the account's current non-zero holdings, and one new small
`MarketBarDaily` query reproduces (not imports) `performance_service.py`'s own multi-provider
ambiguity rule — a `(symbol, date)` with exactly one raw provider row is usable, otherwise that
day is excluded for that symbol. Sample Pearson correlation of simple price returns over the
common usable days for every held pair; `null` with fewer than 2 held symbols, or a pair's own
correlation `null` with fewer than 2 common returns or zero variance in either security. The
reference test seeds real `MarketBarDaily` rows with a genuine two-provider ambiguous day,
proving the exclusion rule against the real query rather than a mock. Seven of the roadmap's
nine Phase 4.2 metrics are now closed (concentration, volatility, max drawdown, beta, historical
VaR, Expected Shortfall, correlation); risk contribution and stress-test loss remain open — the
latter is being picked up next, in progress now.

[PR 49](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/49) is ready with all
CI checks green: `historical_var_95_pct`/`historical_var_99_pct`/`expected_shortfall_95_pct`/
`expected_shortfall_99_pct`, the third slice added to `GET /portfolio/risk-metrics` (additive on
top of PRs #47/#48). Evidence:
[P4D_PORTFOLIO_VAR_ES_VERIFICATION.md](P4D_PORTFOLIO_VAR_ES_VERIFICATION.md). Design:
`docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 3. Nearest-rank empirical quantile over
the exact same period-over-period `twr_index` returns section 1's volatility already computes —
still no change to `performance_service.py`. Explicit, documented minimum sample sizes
(`return_count < 20` nulls every tail field; `< 100` publishes only the 95% pair) so a short
account history never reports the same number at both confidence levels, directly serving the
roadmap's "explicit unavailable rather than misleading estimate" acceptance criterion. Six of
the roadmap's nine Phase 4.2 metrics are now closed (concentration, volatility, max drawdown,
beta, historical VaR, Expected Shortfall); correlation, risk contribution, and stress-test loss
remain open, unstarted.

[PR 48](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/48) is ready with all
CI checks green: `portfolio_beta`/`beta_pair_count`, the second slice added to
`GET /portfolio/risk-metrics` (additive on top of PR #47 — every existing key unchanged).
Evidence: [P4D_PORTFOLIO_BETA_VERIFICATION.md](P4D_PORTFOLIO_BETA_VERIFICATION.md). Design:
`docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md` section 2. Still a pure consumer of one
`build_performance_response` call — pairs an account's `twr_index` with that same day's
`benchmark_index` (both already published; a day pairs only when the account is
`"available"` and `benchmark_index` is non-null that same day), sample covariance of the two
return series over sample variance of the benchmark's own, same `ddof=1`/`Context(prec=50)`
convention section 1's volatility already uses. `null` on fewer than two return pairs or a
benchmark with zero variance across them (a guard, not expected with real SPY data). Four of
the roadmap's nine Phase 4.2 metrics are now closed across PRs #45/#47/#48 (concentration,
historical volatility, max drawdown, beta); historical VaR, Expected Shortfall, correlation,
risk contribution, and stress-test loss remain open, unstarted.

[PR 47](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/47) is ready with all
CI checks green: `GET /portfolio/risk-metrics`, the first slice of Phase 4.2's "Quantitative
risk engine" — historical volatility and maximum drawdown only, of the nine metrics the
roadmap's section 4.2 table lists. Evidence:
[P4D_PORTFOLIO_RISK_METRICS_VERIFICATION.md](P4D_PORTFOLIO_RISK_METRICS_VERIFICATION.md). A new,
isolated `app/services/portfolio_risk.py` reuses the existing `build_performance_response` once
as a black box — no change to `performance_service.py`. Both numbers derive purely from fields
that response already publishes: `max_drawdown_pct` is the existing `drawdown_pct` field's own
maximum across available days (no new arithmetic), and `historical_volatility_pct` is the
sample standard deviation (`ddof=1`) of period-over-period `twr_index` ratios, computed inside
the same `Decimal` `Context(prec=50)`/`.sqrt()` idiom `market_indicators.py`'s Bollinger Bands
code already established. Volatility is explicitly documented as per-period, not annualized —
gaps in the series mean the calendar spacing between two available points is not guaranteed to
be exactly one trading day, so a `sqrt(252)` annualization would misstate the figure.
"Concentration," also on the roadmap's 4.2 metric table, is already closed by the existing
`GET /portfolio/allocation` (PR #45) under a different name — not duplicated here. Still open,
each a separate future unit: beta, historical VaR, Expected Shortfall, correlation, risk
contribution, stress-test loss, and `GET /portfolio/attribution`.

[PR 46](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/46) is ready with all
CI checks green: wires the already-shipped, backend-only Bollinger Bands indicator (PR #44) into
the daily history chart. Plots middle/upper/lower as three overlay lines on the chart's main
price scale per contract section 15.6 — not a sub-panel, since the bands overlay directly on
price, unlike RSI/MACD. Evidence:
[P3A_BOLLINGER_FRONTEND_VERIFICATION.md](P3A_BOLLINGER_FRONTEND_VERIFICATION.md). The middle
band reuses the existing `priceScaleLine` prop path `sma`/`ema` already use; `upper`/`lower` are
parsed with the same `signedSeriesPoint` helper MACD already uses (a zero or negative band
reading is accepted even though real equity data should never produce one), plus a new
invariant check that `upper`/`lower` are `null` on exactly the same indices the middle value is.
With this PR, all five indicators named on the Phase 3 roadmap line ("SMA, EMA, Bollinger Bands,
RSI, and MACD") are selectable and plotted in the chart — the frontend half of that checklist
item is now closed alongside the backend half PR #44 closed. One tooling failure on my end,
disclosed in the verification doc: a stray trailing `&` double-backgrounded the first Grok
launch, killing it before it ran; caught via `git status --short` showing zero changes, fixed on
relaunch. No manual browser/visual check was performed for this unit — verified via the
automated component test and production build only; disclosed explicitly. Still open: chart
modes beyond candlestick, timeframes beyond 1y/2y, volume-only toggle, trade execution markers,
price levels for open orders, persisted chart preferences, user-configurable indicator
parameters beyond period/signal-period, and a shaded fill between the bands (deliberately out of
scope — lightweight-charts has no first-class two-line-fill primitive without an added plugin).
Phase 4.2 (`GET /portfolio/attribution`, `GET /portfolio/risk-metrics`) also remains open and
unstarted.

[PR 45](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/45) is ready with all
CI checks green: a new `GET /portfolio/allocation` route — the exact route the roadmap's own
section 4.5 API list names ("Security/sector weights and cash"). This closes the last
explicitly-named Phase 4.1 checklist item, "Portfolio allocation by security and sector."
Evidence: [P4C_PORTFOLIO_ALLOCATION_VERIFICATION.md](P4C_PORTFOLIO_ALLOCATION_VERIFICATION.md).
Correction worth recording: an earlier note in this file (and said to the user) assumed sector
allocation was blocked on "a sector-taxonomy decision" — that was wrong.
`app/services/sector_classifier.py` already existed (a ~500-symbol S&P 500 static map plus a
keyword fallback, already used by `GET /market/symbols`); this unit reuses it, a new
`app/services/portfolio_allocation.py` module calling the existing `build_portfolio_response`
once as a black box plus one small `MarketSymbol` lookup query. Every weight is `null` when the
underlying valuation is incomplete, so no partial set of percentages that doesn't sum to 100%
is ever returned. With this PR, every explicitly-named item on the Phase 4.1 roadmap checklist
is closed: daily valuation, TWR, drawdown, daily/cumulative P&L, FIFO realized gain/loss
(already existed), performance by position/asset, SPY benchmark comparison, money-weighted
return, and now security/sector allocation. `GET /portfolio/attribution` and
`GET /portfolio/risk-metrics` (Phase 4.2, named in the same roadmap API list) remain open,
separate, larger units — not started.

[PR 44](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/44) is ready with all
CI checks green: `bollinger` as a fifth `name` value on
`GET /market/symbols/{symbol}/indicators` — this closes the Phase 3 roadmap's "SMA, EMA,
Bollinger Bands, RSI, and MACD" indicator line item (the one value on that line still open after
SMA/EMA/RSI/MACD, PRs #30-35). Evidence:
[P3A_BOLLINGER_VERIFICATION.md](P3A_BOLLINGER_VERIFICATION.md). `period` is reused as the
moving-average window; the band-width multiplier is fixed at `2`, not configurable. The middle
band is byte-identical to the existing `sma` output (reuses that function, not a second
independent mean). Design written first as contract section 15, following the exact pattern
RSI and MACD's own addenda used. One `browser` CI run hit the already-known
`test_p3b_watchlists_ui.py` flake, unrelated to this backend-only change; reran clean. Backend
only — the frontend indicator `<select>` and overlay builder are unchanged; `upper`/`lower` are
not yet parsed or plotted. User-configurable indicator parameters beyond period/signal,
persisted chart preferences, and every other open Phase 3 chart item (chart modes beyond
candlestick, timeframes beyond 1y/2y, trade execution markers, price levels for open orders)
remain open.

[PR 43](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/43) is ready with all
CI checks green: a top-level `money_weighted_return_pct` field on `GET /portfolio/performance`'s
response (a sibling of `status`, not a per-day series field) — a single Modified Dietz figure
for the whole requested window. Evidence:
[P4A_PERFORMANCE_MWR_VERIFICATION.md](P4A_PERFORMANCE_MWR_VERIFICATION.md). Null on two
distinct, separately tested guards: fewer than 2 available days, or zero cash
deposit/withdrawal flows in the window — the roadmap's own "money-weighted returns (where
cash-flow history permits)" wording taken literally, since a flow-free window's Modified Dietz
figure would just duplicate the already-reported `twr_index`. Design written first as contract
section 14, independently verified with exact fraction arithmetic (not floats) before
implementation. This closes out every explicitly-named Phase 4.1 roadmap item except sector
allocation, which needs a sector-taxonomy decision first (the `Asset` model has no sector field
today) and is deferred as its own, separate unit.

[PR 42](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/42) is ready with all
CI checks green: `realized_pnl` and `total_pnl` fields on each entry in `GET /portfolio/`'s
`positions` list — a per-asset breakdown of the account-wide `summary.total_realized_pnl`
(grouped with the exact same latest-reset inception boundary, via a shared
`_realized_sell_scope` helper so the two queries can never disagree) plus a combined
realized-and-unrealized total per position. Evidence:
[P4B_POSITION_PERFORMANCE_VERIFICATION.md](P4B_POSITION_PERFORMANCE_VERIFICATION.md). This is
the roadmap's "performance by position/asset" item, on `GET /portfolio/` rather than the
`/performance` series route. Design written first as
[P4B_POSITION_PERFORMANCE_CONTRACT.md](P4B_POSITION_PERFORMANCE_CONTRACT.md), reusing two
already-shipped fixtures' own numbers as the reference, plus a new dedicated reset-boundary
test that exercises the real `append_trade`/`append_reset` ledger path. A never-sold position
reports `realized_pnl = "0.00"` (a measured zero, not null); `total_pnl` is null exactly when
the position's price is unavailable. Money-weighted return, sector allocation, and a relative
account-vs-benchmark field remain open, separate Phase 4.1 units.

[PR 41](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/41) is ready with all
CI checks green: a `benchmark_index` field on each point of `GET /portfolio/performance`'s
daily series — a chained time-weighted price-return index for a fixed benchmark symbol,
`"SPY"`, computed fully independently of the account's own availability or cash-flow logic (a
price return has no deposits, so no flow exclusion is needed). Evidence:
[P4A_PERFORMANCE_BENCHMARK_VERIFICATION.md](P4A_PERFORMANCE_BENCHMARK_VERIFICATION.md). One new
query for the whole window's SPY raw closes (reusing the existing held-asset close query's
shape), walked with its own independent chain-tracking locals that never touch the account's
own. Design written first as contract section 13, with an independently computed reference that
deliberately places SPY's own data gaps on different days than the account's own gaps, to prove
the two chains never need to agree on which days are known — directly asserted by two dedicated
test cases (an account gap with a real SPY index, and a SPY gap on a fully-valued account day).
SPY is hardcoded, not configurable, in this unit. Money-weighted return, performance by
position/asset, sector allocation, and a relative account-vs-benchmark field remain open,
separate Phase 4.1 units.

[PR 40](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/40) landed on
2026-11-07, after PR 39, ready with all 7 CI jobs green on the first attempt: a
`cumulative_pnl` field on each point of `GET /portfolio/performance`'s daily series — total
dollar gain/loss since the series' base day, excluding deposits/withdrawals since then.
Evidence: [P4A_PERFORMANCE_CUMULATIVE_PNL_VERIFICATION.md](P4A_PERFORMANCE_CUMULATIVE_PNL_VERIFICATION.md).
No new query or data source; a second `_flow_since` call anchored at the series' base day
instead of the previous available day. Design written first as contract section 12, with an
independently computed reference continuing the same 10-day scenario sections 5/8/10/11 already
use; a telescoping-sum test proves `cumulative_pnl` agrees with the sum of every `daily_pnl`
since the base day. Money-weighted return, benchmark comparison, performance by position/asset,
and sector allocation remain open, separate Phase 4.1 units.

[PR 39](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/39) landed on
2026-11-07, after PR 38, ready with all 7 CI jobs green on the first attempt: a `daily_pnl`
field on each point of `GET /portfolio/performance`'s daily series — the dollar change in
`account_value` since the last available day, excluding the same cash-flow amount `twr_index`
already excludes. Evidence:
[P4A_PERFORMANCE_DAILY_PNL_VERIFICATION.md](P4A_PERFORMANCE_DAILY_PNL_VERIFICATION.md). No new
query or data source; reuses the exact `flow`/`last_value` locals the TWR calculation already
computes, so the two fields can never disagree about what counts as external cash — proved by
an explicit cross-check assertion (flat dollars if and only if the index didn't move that day).
Design written first as contract section 11, with an independently computed reference
continuing the same 10-day scenario sections 5/8/10 already use. A top-level cumulative-P&L-
since-inception summary, money-weighted return, benchmark comparison, performance by
position/asset, and sector allocation remain open, separate Phase 4.1 units.

[PR 38](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/38) landed on
2026-11-07, after PR 37, ready with all 7 CI jobs green on the first attempt: a `drawdown_pct`
field on each point of `GET /portfolio/performance`'s daily series — the decline from the
running peak `account_value` (available days only) to that day's value. Evidence:
[P4A_PERFORMANCE_DRAWDOWN_VERIFICATION.md](P4A_PERFORMANCE_DRAWDOWN_VERIFICATION.md). No new
query or data source, purely derived from the already-computed `account_value` sequence. Design
written first as contract section 10, with an independently computed reference continuing the
same scenario sections 5/8 already use. Money-weighted return, benchmark comparison,
performance by position/asset, and sector allocation remain open, separate Phase 4.1 units.

[PR 37](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/37) landed on
2026-11-07, after PR 36, ready with all 7 CI jobs green on the first attempt: the first slice of
Phase 4.1 ("Portfolio performance engine") — `GET /portfolio/performance?range=1y|2y`, a daily
account-value time series and time-weighted-return index reconstructed from the ledger,
reconciled against today's live `/portfolio/` valuation. Design written first as its own
contract, [P4A_PERFORMANCE_CONTRACT.md](P4A_PERFORMANCE_CONTRACT.md), with an independently
computed reference scenario. Evidence:
[P4A_PERFORMANCE_VERIFICATION.md](P4A_PERFORMANCE_VERIFICATION.md). Core engine implemented by
Grok's CLI; **a real correctness bug in the contract itself was found and fixed before shipping**:
the first contract draft wrongly claimed no deposit/withdrawal feature exists, missing that
`app/services/cash_movements.py` already posts real `cash_deposit`/`cash_withdrawal` ledger
events via a live route. Without excluding those flows, a deposit would inflate (or a withdrawal
deflate) the reported return — exactly what the roadmap's own acceptance criteria warn against
("Cash deposits are not investment return"). The corrected formula (excluding cumulative
deposits/withdrawals since the last available day, carrying a flow across a data gap correctly)
was implemented directly, not re-delegated, and independently verified against a second
hand-computed reference scenario before shipping. This does not implement money-weighted return,
benchmark comparison, drawdowns, performance by position/asset, or sector allocation — all
remain open, separate, later Phase 4.1 units. No migration. No merge or deploy.

[PR 36](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/36) landed on
2026-11-07, after PR 35, ready with all 7 CI jobs green on the first attempt: MACD as a
selectable chart indicator (MACD line, signal line, histogram, three series sharing one price
scale), frontend-only. Evidence:
[P3A_MACD_CHART_INTEGRATION_VERIFICATION.md](P3A_MACD_CHART_INTEGRATION_VERIFICATION.md). The
real new wrinkle versus RSI's own chart integration: MACD/signal/histogram can be negative, so
new sign-permissive `canonicalSignedValue`/`chartSignedNumber` validators were added alongside
(not replacing) the existing RSI and OHLC ones, and MACD's two independently-timed warm-ups
(line vs. signal/histogram) needed a dedicated per-field parser rather than the single shared
`warmup` cutoff SMA/EMA/RSI use. Implemented by Grok's CLI; one apparent test regression during
review turned out to be a stale Vite/Vitest transform-cache artifact (confirmed by clearing
`node_modules/.vite`), not a real defect. This closes the Phase 3 roadmap's "SMA, EMA, Bollinger
Bands, RSI, and MACD" indicator line item except for Bollinger Bands, which remains open and is
not implemented here. User-configurable indicator parameters beyond the existing period/signal
input, persisted chart preferences, and every other open Phase 3 chart item (chart modes beyond
candlestick, timeframes beyond 1y/2y, trade execution markers, price levels for open orders)
remain open.

[PR 35](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/35) landed on
2026-11-07, after PR 34: MACD as a fourth cached daily indicator (`sma`, `ema`, `rsi`, `macd`),
backend-only, ready with all 7 CI jobs green on the first attempt. Evidence:
[P3A_MACD_INDICATOR_VERIFICATION.md](P3A_MACD_INDICATOR_VERIFICATION.md). Design was written
first as its own contract section, [P3A_INDICATOR_CONTRACT.md](P3A_INDICATOR_CONTRACT.md)
section 14, before any implementation — MACD genuinely differs in shape from `sma`/`ema`/`rsi`:
it conventionally takes three periods (fast, slow, signal), not one, and produces three values
per bar (the MACD line, signal line, histogram), not one. Fast (`12`) and slow (`26`) are fixed,
not configurable, in this unit; the existing `period` query parameter means the signal period
only when `name=macd`. The response shape stays additive-only: `signal`/`histogram` keys are
genuinely absent (not `null`) on `sma`/`ema`/`rsi` points. Implemented by Grok's CLI against that
contract and a 40-point reference table computed independently beforehand from the formula, not
derived from the implementation; verified against that reference line by line before accepting.
Frontend MACD chart integration (three series in one panel: MACD line, signal line, histogram
bars) is a separate, later, bigger unit than RSI's own-panel work, and is not implemented here.

[PR 34](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/34) landed on 2026-11-07,
after the seven below, ready with all 7 CI jobs green: a Range selector (1 year / 2 years) on the
daily chart form, frontend-only, exposing PR 33's backend `range=1y` support (default stays
`2y`). Evidence: [P1C_HISTORY_RANGE_SELECTOR_VERIFICATION.md](P1C_HISTORY_RANGE_SELECTOR_VERIFICATION.md).
Implemented by Grok's CLI; the background process was killed partway by a host memory-pressure
reap (not a task failure — the harness instructs not to restart that automatically), and review
showed the 7 scoped files already complete and correct. Two real gaps surfaced afterward, both
mine: 3 files outside my own scoped list also needed the new function argument (caught via
`tsc` and one test timeout), and a `StaleElementReferenceException` in a browser-test check I
added myself (a stale chart-canvas reference after the test's own range switch remounted the
chart) that CI caught and I fixed on the same branch. This does not add a selector for any
interval other than `1d`, and does not close P3-A.

Three more stacked PRs landed on 2026-11-07, after the four below, each ready with all 7 CI jobs
green: [PR 31](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/31) (per-series
`coverage_status`/`expected_session_count` on `GET /market/data-status`'s
`canonical_history.series[]`, backend-only, evidence
[P1C_DATA_STATUS_COVERAGE_VERIFICATION.md](P1C_DATA_STATUS_COVERAGE_VERIFICATION.md) — the
user chose this per-series design over leaving the top-level fields alone, which stay
`not_verified`/null unconditionally since series can span different dates), [PR 32](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/32)
(persists an unresolved order-retry attempt across reload/unmount so a reload can't mint a new
idempotency key and risk a duplicate order, frontend-only, evidence
[P3B_ORDER_RETRY_DURABILITY_VERIFICATION.md](P3B_ORDER_RETRY_DURABILITY_VERIFICATION.md) — this
closes the "mounted-only unknown-order retry... release-hardening gate" named earlier in this
file), and [PR 33](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/33) (a second
supported history range, `range=1y` alongside `2y`, backend-only, evidence
[P1C_HISTORY_RANGE_1Y_VERIFICATION.md](P1C_HISTORY_RANGE_1Y_VERIFICATION.md)). PRs 31-33 were
implemented by Grok's CLI against precise written specs and independently verified the same way
as 29-30. PR 33's first head's CI caught a real regression — not a flake, confirmed only after
investigating an identical repeated failure rather than assuming flakiness from rereading it a
third time — a test-only monkeypatch fixture (`tests/browser/isolated_api.py`) called the
changed function with a stale argument set; fixed on the same branch. None of these three close
full P3-A, P3-B, or P1-C: MACD, other chart timeframes beyond `1y`/`2y`, preferences, a frontend
range selector, and a frontend `CanonicalHistorySeries` type update for the new per-series
coverage fields (deliberately deferred, no current consumer) remain open.

Four stacked PRs landed on 2026-11-07, each ready with all 7 CI jobs green:
[PR 27](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/27) (reviewed exchange
calendar, see below), [PR 28](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/28)
(volume histogram on the daily chart and a Volume session-prices column — frontend-only, evidence
[P3A_VOLUME_OVERLAY_VERIFICATION.md](P3A_VOLUME_OVERLAY_VERIFICATION.md)), [PR 29](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/29)
(Wilder RSI as a third cached indicator, backend-only, evidence
[P3A_RSI_INDICATOR_VERIFICATION.md](P3A_RSI_INDICATOR_VERIFICATION.md)), and
[PR 30](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/30) (RSI as a selectable
chart indicator on its own price scale, frontend-only, evidence
[P3A_RSI_CHART_INTEGRATION_VERIFICATION.md](P3A_RSI_CHART_INTEGRATION_VERIFICATION.md)). PRs 29
and 30 were implemented by Grok's CLI against precise written specs (including, for RSI, a
reference value table computed independently beforehand from Wilder's formula, not derived from
either implementation) and independently verified — line-by-line diff review, re-run test suites,
and for PR 30 a downloaded-and-reviewed CI screenshot — before being accepted. None of these four
close full P3-A: other indicators (MACD — a bigger design change, since its response shape is
three values per point, not one, unlike SMA/EMA/RSI), other chart timeframes, preferences, and
the `/market/data-status` coverage fields (explicitly deferred, see
[P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md)) remain open. No merge or deploy of any of the four.

The reviewed NYSE exchange calendar for per-symbol history is accepted and is not the next
task. Evidence: [P1C_EXCHANGE_CALENDAR_VERIFICATION.md](P1C_EXCHANGE_CALENDAR_VERIFICATION.md).
Accepted code `5bc6d60` on `codex/v2-exchange-calendar-20261107`, stacked on ready PR 26 at
`9682ae450674ac3ca2012d468feefbb534dd3303`. [PR 27](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/27)
carries this unit. The first implementation head's own CI caught two real issues this unit then
fixed on the same branch: the chart card's Coverage row hardcoded "Not verified" regardless of
the real value, and a browser-test fixture asserted a now-stale literal — see the verification
note's "Corrections found during browser verification" section. Final
[CI 42397343431](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42397343431)
succeeded on all 7 jobs cleanly: backend 318 passed/7 skipped (+15 over PR 26's 303, matching
the 11 new `tests/test_exchange_calendar.py` cases plus 4 new `coverage_status` cases in
`tests/test_market_history.py` exactly), frontend 301 tests in 26 files (+1 for the Coverage-display
fix), browser 10 passed/1 hosted excluded (unchanged count — one existing test corrected, none
added or removed). An earlier intermediate head's browser job failed once on
`test_p3b_watchlists_ui.py` with a `StaleElementReferenceException`; a rerun with no source
change passed clean, confirming an unrelated pre-existing flake. `GET /market/symbols/{symbol}/history`
now reports a real `coverage_status` (`complete`, `gaps`, `unexpected_sessions`,
`gaps_and_unexpected_sessions`, or `not_verified` only when the window is outside the
calendar's 1990-2035 range) and a real `expected_session_count`, computed from a local,
stdlib-only NYSE holiday calendar — no new dependency, no provider call. `GET /market/data-status`
is explicitly unchanged and deferred (no single symbol's sessions to compare against a window
there). The calendar models the standard annual schedule only, not ad hoc closures (9/11,
weather, outages); every rule was checked against a primary or contemporaneous source, not
self-derived. No formal GitHub approval is claimed. No merge or deploy. This acceptance does
not close full P3-A (other indicators, chart modes, timeframes, volume, preferences, the
`data-status` coverage fields), P1-C (provider ingestion remains gated by a written provider
decision), or any other phase.

SMA/EMA chart integration remains accepted historical evidence and is not the next task. Evidence: [P3A_CHART_INTEGRATION_VERIFICATION.md](P3A_CHART_INTEGRATION_VERIFICATION.md). Accepted code `c93250bde11ebfafbb4a4f7bb3072ad28f0ac65b` on `codex/v2-indicator-chart-20261107`, stacked on ready [PR 25](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/25) at `d1753a9abd5e6da6e957677d3588e5dfd949f082`. Draft [PR 26](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/26) carries one Codex-authored browser-test correction, `1fd4e056920402036c82027628d6c912582ef5b3`, on top of that code. Final [CI 42389505205](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42389505205) succeeded on all 7 jobs: backend 303 passed/7 skipped, frontend 300 tests in 26 files, browser 10 passed/1 hosted excluded (including the new `test_indicator_overlay_ui` journey). Codex downloaded and viewed all six new `p3a-indicators-ui` captures from that run: `sma-desktop`, `sma-table`, `ema-desktop`, `insufficient`, `sma-mobile`, `error`. The indicator response now additionally nests the original history object so candles and the overlay share one snapshot; see the updated [P3A_INDICATOR_CONTRACT.md](P3A_INDICATOR_CONTRACT.md) section 7. No formal GitHub approval is claimed. No merge or deploy. This acceptance does not close full P3-A, the reviewed exchange calendar, or any other indicator. Remaining chart modes, timeframes, volume, other indicators, preferences, overlays, provider decisions, P4 analytics, P5 research, P6 forecasts, and release work remain open as the next units to scope.

Cached daily SMA/EMA backend remains accepted historical evidence. Evidence: [P3A_INDICATOR_VERIFICATION.md](P3A_INDICATOR_VERIFICATION.md). Accepted code `770ced43a7ab27c993ed266b72ddc9768061ce5f` on `codex/v2-cached-indicators-20261107`. Draft [PR 25](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/25) is stacked on ready [PR 24](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/24) at `d8ff5167b7b33d90c3e3e15b5abe34ddeb50050e`. Base final [CI 42384433382](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42384433382) succeeded on all 7 jobs. Accepted-code [CI 42385514478](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42385514478) succeeded on all 7 jobs. Backend, Python 3.12, fresh PostgreSQL 17: 303 passed, 6 optional Selenium modules skipped, 916 warnings, 129s. Frontend: 246 tests in 23 files; lint and build passed. Browser: 9 passed, 1 hosted case excluded, 109 warnings, 121.59s. That browser job is the existing journey regression. No frontend file changed and no new screenshots were inspected. Local Python 3.14.6 with `AUDIT_DATABASE_URL` unset, before the last three test additions: 279 passed, 27 skipped, 956 warnings, 76.87s. Focused final run: 40 passed, 38 warnings, 0.91s (26 new indicator cases and 14 history cases). Source of this acceptance is Grok. No formal GitHub approval is claimed. PR 25 stays a draft pending documentation-head CI. That accepted code CI is not the later documentation head. No merge or deploy. This backend acceptance does not close P3-A indicator warm-up on the frontend or any other indicator. Next is an optional SMA/EMA chart integration that returns one original nested history response from the single indicator read, so candles and the overlay share that snapshot. That nest is not implemented. The current indicator response has no history nest. Full calendar, ingestion, P4 and later, and the unknown-order reload retry release gate stay open.

Watchlist UI is accepted and is not the next task. Evidence: [P3B_WATCHLIST_UI_VERIFICATION.md](P3B_WATCHLIST_UI_VERIFICATION.md). Accepted UI code `70f68c72a17ec703dfc9ca5d7da1011472cc53ab`. Targeted Docker zlib fix `4b6bb03566fb2c9e6ac756505a6a24a577f37d00`. Draft [PR 24](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/24) is stacked on backend [PR 23](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/23) and stays pending final documentation-head CI. [CI 42383808088](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42383808088) succeeded on all 7 jobs. Backend, Python 3.12, fresh PostgreSQL 17: 277 passed, 6 optional Selenium modules skipped, 906 warnings, 120.86s. Frontend: 246 tests in 23 files; lint and build passed. Browser: 9 passed, 1 hosted case excluded, 109 warnings, 118.84s, including the new watchlist journey. Codex viewed `public`, `persisted`, `lists-desktop`, `lists-mobile`, `second-owner-empty`, and `deleted` from that CI. No formal GitHub approval is claimed. That accepted code CI is not the later documentation head. The cached daily SMA/EMA backend is the accepted unit above, not the next task. Contract: [P3A_INDICATOR_CONTRACT.md](P3A_INDICATOR_CONTRACT.md). Full P3-A and full P3-B stay open. The persistent backend is accepted code `31333a319e5a0104dacbf8ff1dfa4be2059513c6` on `codex/v2-watchlists-backend-20261107`. Evidence: [P3B_WATCHLIST_VERIFICATION.md](P3B_WATCHLIST_VERIFICATION.md). [CI 42358277720](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42358277720) succeeded on all 7 jobs. Backend, Python 3.12, fresh PostgreSQL 17.11: 277 passed, 5 optional Selenium modules skipped, 906 warnings, 122.55s. Draft [PR 23](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/23) is stacked on PR 22 and stays pending final documentation-head CI. That accepted code CI is not the later documentation head. No formal GitHub approval is claimed. Chart-to-ticket symbol-only integration remains accepted and is not the next task. Evidence: [P3B_CHART_TICKET_VERIFICATION.md](P3B_CHART_TICKET_VERIFICATION.md). Code `464b8fe4a5a77d9aa6f1c4d27c5f43bd30bda008`. [CI 42356350884](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42356350884) succeeded on all 7 jobs. [PR 22](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/22) is ready after final documentation-head [CI 42356944574](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42356944574) at `9f46e49`. Lifecycle UI remains accepted in [P3B_LIFECYCLE_UI_VERIFICATION.md](P3B_LIFECYCLE_UI_VERIFICATION.md) and is not the next task. Do not mark full P3-B done. This note checks no roadmap box. P1 provider, calendar, and ingestion stay open. Remaining P3-A, P4 and later, and the core release gate stay open. The mounted-only unknown-order retry still loses its intent on reload or unmount, and that remains a release-hardening gate.

The accepted order-detail read remains `792aab73061fce3ced67fc03e7150e5e208b8d19` on `codex/v2-order-detail-20261106`. Evidence: [P3B_DETAIL_VERIFICATION.md](P3B_DETAIL_VERIFICATION.md) and [P3B_LIFECYCLE_CONTRACT.md](P3B_LIFECYCLE_CONTRACT.md). Draft [PR 20](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/20) is stacked on PR 19. [CI 42330081496](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42330081496) succeeded on all 7 jobs. At that revision there was no order-detail UI and no proved cancel-versus-fill race. The ticket and backend preview stay accepted historical units. Ticket evidence: [P3B_TICKET_VERIFICATION.md](P3B_TICKET_VERIFICATION.md), `90074df585c413b0305aa56d2197cbc5cde3d213`, [PR 19](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/19), [CI 42327832410](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42327832410).

The accepted backend preview remains `0aa62afd64a24bba2d659dc3044cebe6265e6929` on `codex/v2-order-preview-20261106` and is unchanged. Evidence: [P3B_PREVIEW_VERIFICATION.md](P3B_PREVIEW_VERIFICATION.md). Contract: [P3B_ORDER_PREVIEW_CONTRACT.md](P3B_ORDER_PREVIEW_CONTRACT.md). [PR 18](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/18) is stacked on PR 17. [CI run 42278953737](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42278953737) succeeded on all 7 jobs. Codex review and CI accepted that backend unit. Preview writes no cash, order, holding, lot, or ledger row. `POST /orders/` still revalidates. The existing immediate `POST /trades/` dashboard path stays unchanged. Matching and execution policies stay unchanged. That slice adds no new repository migration and no new grant policy. Existing migration and grant proofs ran only on isolated disposable instances. The hosted database had no migration or grant change. No merge or deploy.

The P3-A first cached chart slice is accepted and is not the next task. Indicator warm-up, a reviewed exchange calendar, provider approval, and live ingestion stay open. P4 and later, and the core release gate, stay open. Full phases stay open. This note checks no roadmap box.

PR 16 (https://github.com/slowgold05/Fintech-trading-risk-engine/pull/16) and PR 17 (https://github.com/slowgold05/Fintech-trading-risk-engine/pull/17) are ready. All 7 CI jobs are green. Main and the hosted service are unchanged. No merge, deploy, or hosted mutation.
