# API inventory

Inventory of the FastAPI application at commit `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`. Routes are the ones registered in `app/main.py` and the router modules. Behavior comes from those handlers, not from names alone.

The hosted site prefixes paths with `/api` and nginx strips that prefix. Paths below are the FastAPI paths. Hosted reads on 2026-11-05 are called out. Other hosted behavior was not called.

## Local follow-up, 2026-11-05 — P1-C read-only groundwork

This section is uncommitted local work after `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`. It does not replace the P0-A observations below. Rows that say a route was absent are still true for that commit.

`GET /market/data-status` and `GET /market/symbols/{symbol}/history` are registered from `app/routers/market_history.py` under `/market`. Both are public cached reads. They do not call a provider and they do not write. History requires an explicit `provider` and `adjustment_type` (`raw` or `split_adjusted`), `interval=1d`, and `range=2y`, and the read is limited to that inclusive daily window. Coverage is `not_verified`. `collection: disabled` means canonical-history ingestion is off, not that existing quote refresh paths are off. The response and population rules are in [P1C_DATA_CONTRACT.md](P1C_DATA_CONTRACT.md). No ingestion writer is implemented. This follow-up is not provider approval and it is not two-year coverage.

## Authorization model

| Dependency | Who passes |
| --- | --- |
| None | Public |
| `get_current_user` | Any valid access token. Roles: `trader`, `analyst`, `compliance_officer`, `admin`, `auditor` |
| `get_current_trader` | `role == "trader"` |
| `get_current_compliance_user` | `compliance_officer`, `admin`, or `auditor` |

Invalid or expired tokens return 401. The refresh cookie is `HttpOnly` and is rotated by `POST /auth/refresh`. Tests: `tests/test_auth.py`, including expired and no-expiry tokens.

Trader-only mutations reject other roles with 403. Compliance reads reject everyone outside the three compliance roles. Some compliance writes add a tighter role check in the router. Several write services also require a different person than the requester. Those service predicates are covered by `tests/test_compliance.py`, `tests/test_surveillance.py`, and `tests/test_phase5_aml.py`. This inventory names the router gates that were read. It does not restate every service predicate.

## Auth

Router prefix `/auth`. `POST /token` in `app/main.py` calls the same login function.

| Method and path | Auth | Caller | Mutation | Response and source | Tests |
| --- | --- | --- | --- | --- | --- |
| `POST /auth/register` | Public. 5/minute | `register` in `frontend/src/api/auth.ts` | Creates a user, screens an optional name, writes an opening ledger for the default `$100,000` cash | `UserOut` | `test_register_login_and_me`, weak and duplicate password tests |
| `POST /auth/login`, `POST /token` | Public. 5/minute. Form username and password | `login` | Failure and success write login events. An enrolled factor returns `mfa_required`, `challenge_id`, and `reasons` and does not issue a session | Otherwise `access_token`, `token_type`, `mfa_required: false`, plus a refresh cookie | `tests/test_auth.py`, `tests/test_phase4_identity.py` |
| `POST /auth/login/mfa` | Challenge body | `completeLoginMfa` | Consumes a challenge and issues a session | Token response | Enrollment and step-up tests |
| `POST /auth/refresh` | Refresh cookie | Client interceptor and `refreshSession` | Rotates the cookie | New access token, or 401 | `test_refresh_rotates_cookie_and_issues_new_access_token` |
| `POST /auth/logout` | Cookie | `logout` | Revokes the refresh token | Empty success path | `test_logout_revokes_refresh_cookie` |
| `POST /auth/mfa/setup`, `POST /auth/mfa/confirm` | Current user | No current page caller found | Enrollment secrets | Setup payload | Phase 4 tests |
| `POST /auth/mfa/enroll`, `POST /auth/mfa/enroll/confirm` | Email and password body | Login page | Starts or confirms a factor | Secret and otpauth URI, then empty confirm | `Login.test.tsx` mocks the client |
| `GET /auth/me` | Current user | Shell, portfolio, compliance | None | `UserOut`, including `role` | `test_register_login_and_me` |
| `PUT /auth/name` | Current user. 5/minute | Portfolio page | Screens the name, then stores it. A blocked name does not replace a stored clear name after the screen is recorded | `{full_name}` | `tests/test_phase5_aml.py` |

MFA secrets are encrypted with a keystream from `JWT_SECRET`. This task did not rotate that secret.

## Market data

Router `app/routers/market.py` has no auth dependency.

| Method and path | Caller | Mutation | Data source and response | Tests and hosted check |
| --- | --- | --- | --- | --- |
| `GET /market/overview` | `fetchMarketOverview` | None | Reads `market_quote_cache` for four index ETFs and eleven sector ETFs. Returns `as_of`, `trends`, `sectors`, `errors`. A missing cache row is an error entry, not a fabricated price | Hosted 2026-11-05: 4 trends, 11 sectors, 0 errors, `as_of` `2026-11-04T00:00:00+00:00` |
| `GET /market/trending` | `fetchMarketTrending` | None | Calls Alpha Vantage `TOP_GAINERS_LOSERS` through an in-process cache. Failure returns empty lists and `errors` | Not called on the host. Local parser tests do not prove a live provider call |
| `GET /market/heatmap` | `fetchMarketHeatmap` with `limit=1000` | None | Joins active, non-test, non-ETF symbols to the quote cache. Returns `as_of`, `data_notice`, `status_counts`, `items`. Items omit sector `Other` | Hosted `limit=1000`: status counts delayed 105, cached 5, stale 454, live-ish 0. 234 items, all `source=yahoo`. Latest `as_of` `2026-11-04`. Notice says the quotes are not for order execution |
| `GET /market/universe` | No frontend caller | None | Active `market_symbols` with optional `search`, `limit`, `offset`. Fields include symbol, company, exchange, inferred sector, ETF flag, refresh tier | Hosted `limit=1`: `total` 12924. Sample `A`, `NYSE`, `daily` |
| `GET /market/research/{symbol}` | `fetchMarketResearch` | A SEC cache miss fetches company facts and commits `market_fundamentals_cache`. A row newer than 24 hours is returned without that fetch | Alpha Vantage overview and quote, plus SEC fundamentals. Score is a local formula. Missing providers become `errors` | Not called on the host, so this task did not write a fundamentals row |

`GET /` and `GET /health` are on the app, not the market router. Hosted `GET /api/health` returned `{"status":"ok"}`. Hosted `GET /api/docs` returned 404, which matches `enable_api_docs` off.

### Portfolio pricing, end to end

`GET /portfolio/` in `app/routers/portfolio.py` loads the caller's holdings and, for each holding, calls `get_live_price(asset.symbol, asset.asset_type)`.

`get_live_price` in `app/services/price_service.py` has two in-process layers:

- `_cache`, set by `_set_cached`, lasts 30 seconds and is keyed by symbol and asset type.
- `_quote_cache`, set by `_set_cached_quote`, lasts 300 seconds and is keyed by symbol. `get_stock_quote` reads it before any HTTP call.

For a stock, `get_live_price` returns the 30-second entry when it is present. On a miss it still requires `ALPHA_VANTAGE_API_KEY`, then calls `get_stock_quote`. That function returns the 300-second quote without a provider call when the quote is warm. Only a miss of both layers requests `GLOBAL_QUOTE`. One function call per holding does not mean one provider request per holding. A second holding in the same symbol, or a later call inside 300 seconds, can reuse the quote. Two different symbols still miss separately. Any other asset type skips the quote cache and calls `CURRENCY_EXCHANGE_RATE` after the 30-second price miss.

The portfolio handler turns a bad or non-positive price into HTTP 502 for the entire response. It does not return a per-position unavailable price. The JSON has no snapshot id and no quote timestamp. Nothing in the handler forces one clock time across symbols. The process caches are not a database snapshot, and they are not shared across processes. Valuations can still disagree with `market_quote_cache` and with each other when the TTLs or symbols differ. The provider dependency remains: a cold cache needs Alpha Vantage, and a missing key still fails the request.

The response uses `float` after quantizing money to cents and prices to four decimal places.

This path does not read `market_quote_cache`. The order book does. `place_order` prices a fill at the resting maker's limit price and checks the cache for the reference band and concentration. `POST /trades/` uses `get_live_price` again, so an immediate fill and a portfolio refresh can disagree with the cache and with each other.

SQLite tests patch `app.routers.portfolio.get_live_price` and `app.routers.trades.get_live_price`. They do not prove provider behavior. No code change was made.

### Daily history, universe, freshness, and quality

| Question | What the code does |
| --- | --- |
| Store | `price_history_daily` has symbol, date, open, high, low, close, volume, and source. Primary key and unique constraint are symbol plus date. The model default source is `stooq`. There is no interval, adjustment type, quality status, `fetched_at`, or checksum column |
| What a refresh writes | Yahoo chart `range=5d&interval=1d`. `_latest_complete_daily_bar` keeps one complete bar. `_write_price_history_daily` inserts or overwrites that symbol and date and sets source to `yahoo` |
| Scheduler | With scheduled jobs enabled, `refresh_market_caches` calls `refresh_quote_cache(..., source="eod")` for tiers `hot` and `daily`, in batches of at most 50, up to the configured limits (defaults 200 hot and 100 daily). The same write stores the quote cache and that one daily bar |
| Universe | `sync_nasdaq_universe` loads Nasdaq Trader nasdaqlisted and otherlisted files. Test issues are inactive. Hot tier is the `HOT_SYMBOLS` set. Everyone else is `daily`. The sync is the refresh script, not every scheduler cycle. Hosted active count on 2026-11-05 was 12924. The heatmap join found 564 non-ETF cache rows |
| Freshness | `_freshness` treats Yahoo and Alpha Vantage dates within 1 day as `delayed`, through 7 days as `cached`, and older as `stale`. The hosted census above is the live result of that function. `quote_at` is midnight on the bar date |
| Adjustment | The Yahoo request does not send an adjustment parameter, and the row has no adjustment field. This inventory does not assign a split or dividend convention |
| Provenance | Quote cache stores source, `quote_at`, and `fetched_at`. The daily bar stores source only |
| Quality enforcement | `app/services/market_quality.py` can flag missing, stale, and inconsistent bars. The refresh writer does not call it. `risk_inputs_allowed` is not referenced by the order or portfolio path. `tests/test_expansion.py` calls the checker directly. The Yahoo parser skips a bar with a null, non-finite, or non-positive price. It does not reject `high < low` before the latest-bar search gives up |
| Two-year pipeline | Not present. A latest quote and a one-row daily upsert are not a two-year historical load |

`tests/test_market_data_refresh.py` covers a partial EOD batch, stale provider dates, decimal prices, and the hot-quote control. It uses fixtures, not the hosted cache.

## Portfolio, orders, trades, and cash

All of these routers depend on `get_current_user`. Mutations named below also require `get_current_trader`.

| Method and path | Caller | Mutation | Response | Tests |
| --- | --- | --- | --- | --- |
| `GET /portfolio/` | Dashboard and portfolio page | None. Reads holdings, lots indirectly through stored averages, trades for realized P&L, open-order reserved cash | `user`, `positions`, `summary` with cash, buying power, account value, cost, unrealized and realized P&L | `tests/test_isolation.py`, ledger and trade tests, with prices patched |
| `POST /portfolio/reset` | No frontend caller | Trader only. Rejects when an order is open. Appends a reset ledger event, deletes lots and holdings, sets cash to `100000` | Cash, buying power, and account value of `100000.0` | `test_reset_preserves_trade_history_and_reconciles` |
| `GET /portfolio/pnl` | Dashboard and portfolio page | Route is not registered | The client treats the failure as unavailable | No backend test, because the route is absent |
| `GET /orders/` | Trades page | None | Caller's orders, default limit 50, with symbol, side, type, quantity, remaining, limit, status, time | `tests/test_orders.py` |
| `GET /orders/book/{symbol}` | No frontend caller | None | Bids and asks for an active symbol, or empty lists | Order-book tests |
| `POST /orders/` | Trades page. Idempotency-Key required. Optional `X-Step-Up-Code` | Trader only. 60/minute. Places and matches. Fills at the resting limit price. Market remainder is canceled | Order fields plus `trade_ids` | Price-time, partial fill, idempotency, band, concentration, halt, ownership |
| `POST /orders/{order_id}/cancel` | Trades page | Trader only. Owner cancel releases the reservation | Order fields | Cancel and owner tests |
| `GET /trades/` | Dashboard and trades page | None | Caller's fills, default 20, with notional and realized P&L | Trade and isolation tests |
| `POST /trades/` | Dashboard quick trade | Trader only. Immediate fill at `get_live_price`. 502 on a bad price. Checks halt, buying power, concentration, and shares | `{trade_id, risk_score}` | `tests/test_trades.py`, with the price patched |
| `GET /cash/movements` | No frontend caller | None | Caller's deposit and withdrawal rows | Cash tests in the audit and AML modules |
| `POST /cash/movements` | Portfolio page | Trader only. 30/minute. Idempotency key. Withdrawal screens the user and checks cash after reservations. Large notional can require a step-up code. The movement commits even if the following AML scan fails | `{id, kind, amount}` | Replay, lock, and sanctions tests. The PostgreSQL double-spend proof was skipped in this run |
| `GET /assets/` | No frontend caller | None | Assets that exist because something traded them. This is not the Nasdaq universe | Schema `AssetOut` |

`GET /risk/` returns up to 50 of the caller's assessments, with alerts and the related trade. An empty book returns `{assessments: []}`. `GET /risk/trade/{trade_id}` returns one assessment or a message. The risk page calls only the list. Tests: `tests/test_risk.py`. These rows are post-trade rule scores. They are not the roadmap's volatility, beta, VaR, or scenario APIs.

## Compliance

Prefix `/compliance`. Every route requires a compliance role. Frontend callers are in `frontend/src/api/compliance.ts` unless noted.

| Method and path | Extra router gate | Mutation |
| --- | --- | --- |
| `GET /compliance/trading-halt` | Compliance read | None |
| `PUT /compliance/trading-halt` | Admin | Writes halt state and an event |
| `GET /compliance/trading-halt/events` | Compliance read | None |
| `GET /compliance/controls`, `/risks`, `/role-changes` | Compliance read | None |
| `GET /compliance/role-requests` | Compliance read | None |
| `POST /compliance/role-requests` | Admin | Creates a role request |
| `POST /compliance/role-requests/{id}/approve` | Compliance officer | Records approval, approver, and time only. Does not change `users.role`. The separate privileged operator command in `app/scripts/set_user_role.py` applies an approved request |
| `GET /compliance/access-review` | Compliance read | None |
| `POST /compliance/access-review` | Admin or compliance officer | Appends a quarterly review |
| `GET /compliance/surveillance/rules`, `/surveillance/cases` | Compliance read | None |
| `POST /compliance/surveillance/rules/{rule_id}/request` | Compliance role | Requests activation |
| `POST /compliance/surveillance/activations/{id}/approve` and `/reject` | Compliance role, service separation | Decides activation |
| `POST /compliance/surveillance/cases/{id}/close` | Compliance role, service separation | Closes a case |
| `POST /compliance/surveillance/run` | Admin or compliance officer | Runs a scan |
| `GET /compliance/aml/rules`, `/aml/cases` | Compliance read | None |
| `POST /compliance/aml/rules/{rule_id}/request` | Compliance role | Requests activation |
| `POST /compliance/aml/activations/{id}/approve` and `/reject` | Compliance role, service separation | Decides activation |
| `POST /compliance/aml/cases/{id}/close` | Compliance role | Closes a case |
| `POST /compliance/aml/run` | Admin or compliance officer | Runs a scan |
| `GET /compliance/incidents` | Compliance read | None |
| `POST /compliance/incidents` | Compliance role | Opens an incident |
| `POST /compliance/incidents/{id}/notify` and `/close` | Compliance role, service separation | Notice and close |
| `GET /compliance/kris` | Compliance read | None |
| `POST /compliance/sar-drafts` | Compliance role. No frontend caller | Stores a template draft |
| `GET /compliance/evidence-export` | Compliance read. Frontend download helper | None. Zip of stored payloads |
| `GET /compliance/intents` | Compliance read | None |
| `POST /compliance/intents` | Admin or compliance officer. No frontend caller | Stores a proposal. Approval is a different route and does not place an order |
| `POST /compliance/intents/from-bars` | Admin or compliance officer. No frontend caller | Builds a proposal from supplied closes |
| `POST /compliance/intents/{id}/approve` | Compliance role | Records the decision |
| `GET /compliance/findings`, `/risk-brief` | Compliance read | None |

Hosted compliance was not called in this task. The 2026-11-04 deployment note says live HTTP checks of these reads passed then. That note is documented only.

## Roadmap routes compared with this commit

| Proposed route | This commit |
| --- | --- |
| `GET /market/search` | Absent. `GET /market/universe?search=` filters symbol and company name |
| `GET /market/symbols/{symbol}` | Absent. Research and universe rows cover parts of a profile |
| `GET /market/symbols/{symbol}/quote` | Absent. Overview and heatmap expose cached rows. Research calls Alpha Vantage for one symbol |
| `GET /market/symbols/{symbol}/history` | Absent. Daily rows exist in the database and have no read API |
| `GET /market/symbols/{symbol}/indicators` | Absent |
| `GET /market/movers` | Absent. `GET /market/trending` is a provider top-list, not a universe ranking |
| `GET /market/sectors` | Absent. Sector ETFs are inside `GET /market/overview` |
| `GET /market/data-status` | Absent. Heatmap returns `status_counts` for the joined non-ETF cache, which is a partial status |
| Watchlist collection | Absent |
| `GET /portfolio/performance`, `/allocation`, `/attribution`, `/risk-metrics` | Absent. `GET /portfolio/` is the holdings summary |
| `POST /portfolio/trade-impact` | Absent |
| `POST /risk/scenarios` | Absent |
| Research and forecast job routes | Absent |

Existing order, cancel, fill, and cash routes should be kept. A new preview route must not be added by renaming `POST /trades/` or `POST /orders/`.

## Eight signal identities

`grc/signals/accounts.yaml` is a curated registry. The file says it is not a live Bluesky connection. `app/services/signals.py` loads that YAML. `review_account` does not fetch a network profile. There is no `signal_items` table. Signal handles are not rows in `users` and have no brokerage role.

On 2026-11-05, `review_account` was run on the eight `accounts` entries:

| Handle | YAML status | `review_account` missing fields |
| --- | --- | --- |
| `@financialtimes.com` | approved | `did`, `approver` |
| `@reuters.com` | approved | `did`, `approver` |
| `@yahoofinance.com` | approved | `did`, `approver` |
| `@barrons.com` | approved | `did`, `approver` |
| `@unusualwhales.bsky.social` | approved | `approver` |
| `@bencarlson007.bsky.social` | approved | `did`, `identity`, `approver` |
| `@hmeisler.bsky.social` | provisional | `did`, `identity`, `recent_post`, `approver` |
| `@walterdeemer.bsky.social` | provisional | `did`, `identity`, `recent_post`, `approver` |

The YAML word `approved` does not satisfy `review_account`. Every seed fails because `approved_by` and `approved_at` are blank. The three `rejected` handles are `@leadlagreport.bsky.social`, `@watcher.guru`, and `@unusualwhalec.bsky.social`. They are not part of the eight.

`link_tickers` accepts a cashtag only when the symbol is in a caller-supplied universe. Sentiment is a six-word lexicon. The manipulation label is the fixed string `unusual activity, needs review`. Tests: `test_signal_checks_ignore_bare_words_and_do_not_name_accounts` and `test_missing_approver_opens_a_finding_and_a_workpaper` in `tests/test_expansion.py`.

## 2026-11-09 note

This inventory still describes `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`,
still `main`'s tip. Many routes have since been added on an unmerged local
branch — canonical daily history, watchlists, the order ticket/lifecycle,
Phase 4's performance/allocation/attribution/risk-metrics/trade-impact/
scenarios routes, Phase 5's research job/brief routes, and Phase 6's forecast
job/result/model/evaluation routes (the "Roadmap routes compared with this
commit" table above is accordingly stale for several rows). Each of those
routes has its own dated contract in `docs/P*_CONTRACT.md`; the current index
is [V2_BACKLOG.md](V2_BACKLOG.md). This file is not rewritten route-by-route
here, to avoid duplicating that already-maintained evidence.
