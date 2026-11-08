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
