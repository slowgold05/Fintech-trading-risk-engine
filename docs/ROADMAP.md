# Implementation Roadmap

Companion to `PROJECT_REVIEW.md` (the review explains *why*; this file is the *how*).
Each feature is broken into concrete steps with the files involved. Phases are ordered
by dependency — later phases build on earlier ones. Check items off as you go.

---

## Phase 1 — Fix the market data pipeline (unblocks everything visual)

**Goal:** fully populated heatmap and price history using free EOD data (Stooq, Yahoo/yfinance),
keeping Alpha Vantage only for on-demand research.

- [x] 1.1 Add `yfinance` (or plain `requests` for Stooq/Yahoo EOD requests) to `requirements.txt`.
- [x] 1.2 Create `app/services/eod_service.py`:
  - `fetch_eod_batch(symbols: list[str]) -> dict[str, Quote]` — batch download
    (yfinance supports hundreds of tickers per call; Stooq is one CSV GET per symbol:
    `https://stooq.com/q/l/?s={symbol}.us&f=sd2t2ohlcv&h&e=csv`).
  - Normalize into the same shape `get_stock_quote()` returns (price, change,
    change_percent, volume).
- [x] 1.3 Update `app/services/market_cache_service.py::refresh_quote_cache` to use the
  EOD batch source with `source="yahoo"`; remove the 12-second delay
  for this path. Keep Alpha Vantage as an optional fallback.
- [ ] 1.4 Update `app/scripts/refresh_market_data.py` — add `--source eod` flag; a full
  1,000-symbol refresh should complete in minutes.
- [x] 1.5 Add a `price_history_daily` table (symbol, date, open, high, low, close, volume)
  + Alembic migration. Populate during the nightly refresh (yfinance gives history in the
  same call). This feeds charts, VaR, and backtesting later.
- [ ] 1.6 Schedule the nightly job (Windows Task Scheduler now; cron/container scheduler
  when deployed).
- [ ] 1.7 Frontend: remove/demote the mock fallback dataset in
  `frontend/src/features/dashboard/mockData.ts` and `marketSnapshot.ts` once real data flows.

**Done when:** `/market/heatmap` returns 1,000 populated tiles with `data_status: "delayed"`.

---

## Phase 2 — Cash balance & paper-trading framing

**Goal:** users get $100k paper cash; trades check buying power.

- [x] 2.1 Migration: add `cash_balance NUMERIC(18,2) DEFAULT 100000` to `users`.
- [x] 2.2 `app/routers/trades.py::create_trade`:
  - BUY: reject if `notional > cash_balance` (HTTP 400 "Insufficient buying power");
    deduct on success.
  - SELL: credit proceeds.
  - Do both inside the existing transaction.
- [x] 2.3 `app/routers/portfolio.py`: include `cash_balance` and
  `total_account_value = cash + positions` in the summary.
- [x] 2.4 Optional: `POST /portfolio/reset` — wipe holdings/lots/trades and restore $100k
  (great for demos).
- [x] 2.5 Frontend: show cash + buying power on Dashboard and in `QuickTradePanel`;
  disable the Buy button when insufficient.

**Done when:** you cannot buy more than your cash, and the dashboard shows account value = cash + positions.

---

## Phase 3 — Test foundation

**Goal:** pytest suite covering money paths before touching them further.

- [x] 3.1 Add `pytest`, `pytest-cov`, `httpx` to a `requirements-dev.txt`.
- [x] 3.2 Create `tests/conftest.py`: SQLite in-memory engine, `TestClient` fixture,
  dependency override for `get_db`, a `make_user`/`auth_headers` helper, and a monkeypatched
  `get_live_price` returning fixed prices (no network in tests).
- [x] 3.3 `tests/test_auth.py`: register → login → `/auth/me`; duplicate email 400;
  wrong password 401; expired/garbage token 401.
- [x] 3.4 `tests/test_trades.py`: buy creates holding+lot; FIFO sell across two lots
  computes correct realized P&L; oversell rejected; cash deducted/credited (Phase 2).
- [x] 3.5 `tests/test_isolation.py`: user B cannot see user A's trades/portfolio/risk.
- [x] 3.6 `tests/test_risk.py`: 5-trades-in-5-min rule fires; large-notional rule fires.
- [x] 3.7 Frontend: add `vitest` + a couple of component tests (`format.ts`, `RiskBadge`).

**Done when:** `pytest` green locally; aim for the trade/lot logic at ~90% coverage.

---

## Phase 4 — Auth hardening (the "security-focused" backbone)

- [x] 4.1 **Startup secret check** — in `app/core/config.py`, raise on startup if
  `jwt_secret` is `"change_me"` or shorter than 32 chars.
- [x] 4.2 **Rate limiting** — add `slowapi`; `5/minute` on `/auth/login` + `/auth/register`,
  sane default on trade creation. Return 429 with `Retry-After`.
- [x] 4.3 **Refresh tokens**:
  - `refresh_tokens` table (id, user_id, token_hash, expires_at, revoked_at, user_agent, ip).
  - Login sets an httpOnly `refresh_token` cookie (30 days) + returns the short-lived
    access token as today.
  - `POST /auth/refresh` rotates the refresh token and issues a new access token.
  - `POST /auth/logout` revokes it.
  - Frontend `client.ts`: on 401, try `/auth/refresh` once before redirecting to login —
    this also fixes the logout-on-F5 problem.
- [x] 4.4 **Timing-safe login** — hash a dummy password when the email doesn't exist.
- [x] 4.5 **Password policy** — min 8 chars + zxcvbn-style strength check in `UserCreate`
  validator; strength meter on the register form.
- [x] 4.6 **Security headers** — middleware adding `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, HSTS (when deployed behind TLS).
- [x] 4.7 **Account lockout** — after 10 failed logins per email+IP in 15 min, require the
  rate-limited cooldown (piggybacks on 4.2 storage).

**Done when:** brute-forcing login is throttled, refresh keeps sessions alive across
reloads, and the app refuses to boot with a default secret.

---

## Phase 5 — Audit log & account activity

- [ ] 5.1 `audit_events` table: id, user_id (nullable for failed logins), event_type
  (`login_success`, `login_failed`, `token_refresh`, `logout`, `trade_executed`,
  `risk_alert`, `agent_intent_created`, `agent_intent_approved`, ...), ip, user_agent,
  detail JSON, created_at. Append-only — no update/delete endpoints.
- [ ] 5.2 `app/services/audit_service.py::record(db, user_id, event_type, request, **detail)`.
- [ ] 5.3 Call it from auth routes, trade creation, risk alerts (and later, agent actions).
- [ ] 5.4 `GET /account/activity` — paginated, current user only.
- [ ] 5.5 Frontend: "Account activity" page (table with event icons, IP, timestamp).

---

## Phase 6 — Portfolio snapshots & real charts

- [ ] 6.1 `portfolio_snapshots` table: user_id, date, cash, positions_value, total_value,
  unique (user_id, date).
- [ ] 6.2 Snapshot job in the nightly refresh script (after EOD prices land): value every
  user's holdings at closing prices.
- [ ] 6.3 Also write a snapshot on every trade (upsert today's row) so charts feel live.
- [ ] 6.4 `GET /portfolio/history?days=90` endpoint.
- [ ] 6.5 Frontend: wire `PortfolioChart` to real history; delete the mock series. Add
  benchmark overlay (SPY from `price_history_daily`) — "you vs the market".

---

## Phase 7 — Risk engine v2

Prereqs: Phases 1 (price history) and 6 (snapshots).

- [ ] 7.1 `risk_limits` table (per user, seeded with defaults): max_trade_notional,
  max_daily_trades, max_daily_loss, max_position_concentration_pct, allowed_asset_types.
- [ ] 7.2 Refactor `app/services/risk_engine.py` into composable rules, each returning
  `(score_delta, alert | None)`:
  - existing: trade frequency, large notional
  - **concentration**: position would exceed X% of account value
  - **sector concentration**: sector > Y% of portfolio (sector from `market_symbols`)
  - **daily loss limit**: realized P&L today below -limit → block, not just warn
  - **volatility**: 30-day annualized σ from `price_history_daily` above threshold
  - **beta-adjusted exposure**: portfolio beta × value vs limit
- [ ] 7.3 Blocking vs advisory: rules can return `severity: "block"` → trade rejected with
  the reason (409), logged to audit.
- [ ] 7.4 `GET /risk/limits` + `PUT /risk/limits` (user-configurable within server-side
  hard caps).
- [ ] 7.5 Portfolio-level metrics endpoint `GET /risk/portfolio`: historical VaR (95%,
  1-day, from snapshot returns), max drawdown, portfolio beta, diversification score.
- [ ] 7.6 Frontend: Risk page gets a "Portfolio risk" section (VaR, drawdown, beta gauges)
  + a limits settings card.

---

## Phase 8 — Market sentiment

- [ ] 8.1 Migration: `market_sentiment_cache` (scope: `market` | ticker symbol,
  sentiment_score, label, article_count, top_headlines JSON, source, fetched_at).
- [ ] 8.2 `app/services/sentiment_service.py`:
  - `fetch_news_sentiment(tickers)` — Alpha Vantage `NEWS_SENTIMENT` (key already
    configured); cache per ticker + an aggregate market row. Respect the 25/day quota:
    1 market-wide call + top-N held/watched tickers daily.
  - `fetch_fear_greed()` — CNN endpoint
    (`https://production.dataviz.cnn.io/index/fearandgreed/graphdata`, unofficial) with
    `api.alternative.me/fng/` as crypto/backup. Cache daily.
  - `fetch_wsb_buzz()` — `https://tradestie.com/api/v1/apps/reddit` (free), cache hourly.
- [ ] 8.3 Add sentiment refresh to `app/scripts/refresh_market_data.py` (`--sentiment` flag).
- [ ] 8.4 Endpoints: `GET /market/sentiment` (market mood: fear/greed + aggregate news +
  WSB top tickers) and fold per-symbol sentiment into `GET /market/research/{symbol}`.
- [ ] 8.5 Frontend: Fear & Greed gauge + "Social buzz" panel on Home; sentiment chip +
  headline list on the research view.
- [ ] 8.6 (Later) `FinBERT` local scoring of RSS headlines as an unlimited-quota
  replacement for 8.2's news sentiment.

---

## Phase 9 — AI trading analyst (trade intents)

Prereqs: Phases 2 (cash), 5 (audit), 7 (risk limits), 8 (sentiment). The security story
*is* the feature: the model proposes, deterministic server-side rules dispose.

- [ ] 9.1 Migrations:
  - `trade_intents`: user_id, symbol, action (buy/sell/hold), quantity, confidence,
    rationale, risks JSON, status (`proposed` → `approved`/`rejected`/`expired` →
    `executed`/`failed`), risk_validation JSON, created_at, decided_at, trade_id FK nullable.
  - `agent_runs`: user_id, model, context_snapshot JSON (portfolio, quotes, sentiment
    sent to the model), raw_output JSON, intent_id FK nullable, token_usage, created_at.
- [ ] 9.2 Add `anthropic` to `requirements.txt`; `ANTHROPIC_API_KEY` in `.env` /
  `.env.example`; per-user opt-in flag `agent_enabled` on users.
- [ ] 9.3 `app/services/agent_service.py`:
  - Build context: positions, cash, cached quotes for held + watchlist symbols,
    sentiment snapshot, current risk limits.
  - Call Claude (`claude-opus-4-8`, structured output → `TradeIntent` Pydantic model,
    adaptive thinking). System prompt: cautious analyst, delayed data, prefer hold.
  - Persist the full `agent_runs` row (prompt context + raw output) **before** creating
    the intent — the decision log is non-negotiable.
- [ ] 9.4 `app/services/risk_engine.py::validate_intent(db, user, intent)` — reuse Phase 7
  rules + intent-specific caps (max notional, allowed universe, cooldown since last agent
  trade, max intents/day). Store the pass/fail detail in `risk_validation`.
- [ ] 9.5 Endpoints (all auth'd, all audited):
  - `POST /agent/analyze` → runs the agent, returns the intent (rate-limited, e.g. 5/day)
  - `GET /agent/intents` → history
  - `POST /agent/intents/{id}/approve` → re-validate against risk limits **again** at
    approval time (prices moved), then execute through the existing trade path
  - `POST /agent/intents/{id}/reject`
  - Intents auto-expire after e.g. 1 hour (stale quotes).
- [ ] 9.6 Frontend: "AI Analyst" panel — Run Analysis button, intent card (action, size,
  confidence meter, rationale, listed risks, risk-check results), Approve/Reject buttons,
  intent history table.
- [ ] 9.7 Tests: mock the Anthropic client; assert an intent violating limits can never
  reach `executed` even if approved; assert every run writes an `agent_runs` row.
- [ ] 9.8 (Later) scheduled daily run per opted-in user; kill switch env flag
  `AGENT_ENABLED=false` that disables all agent endpoints.

---

## Phase 10 — Ship it (deploy + CI)

- [ ] 10.1 `Dockerfile` (backend) + `frontend/Dockerfile` (build → nginx) +
  `docker-compose.yml` (api, frontend, mysql, nightly-refresh cron container).
- [ ] 10.2 Pin `requirements.txt` versions (`pip freeze` into a constraints file).
- [ ] 10.3 GitHub Actions: on PR → `pytest`, `ruff`/`flake8`, `npm run lint`,
  `npm run build`, `pip-audit`, `npm audit --audit-level=high`.
- [ ] 10.4 Deploy: Railway/Render/Fly.io for API + MySQL (or switch to Postgres),
  Vercel/Netlify for the frontend; set real `CORS_ORIGINS`, secrets from the platform's
  secret store.
- [ ] 10.5 Real `GET /health` (checks DB connection + cache freshness); structured JSON
  logging with request IDs.
- [ ] 10.6 `Decimal` migration for money math (do this alongside — the test suite from
  Phase 3 protects you).

---

## Feature backlog — more ways to level up

Ordered roughly by impact-per-effort. Each fits the existing architecture.

### Product / trading
- **Watchlists** — `watchlists` + `watchlist_items` tables, CRUD endpoints, star icon on
  any symbol, watchlist rail on the dashboard. Cheap; also defines which tickers get
  priority sentiment + hot-tier quotes.
- **Price alerts** — "notify me when NVDA drops 5%"; checked during the nightly/hot
  refresh against cached quotes; delivered as in-app notifications (bell icon) first,
  email later. Shows off background-job design.
- **Stock screener** — you already store fundamentals + sector + market data; add
  `GET /market/screen?sector=Technology&pe_max=25&sort=change_percent`. A filterable
  table page makes the universe data genuinely useful.
- **Backtesting (simple)** — with `price_history_daily`, let users test "buy X% dip,
  sell +Y%" rules over the past year and chart the equity curve vs SPY. Very demo-able.
- **Trade journal** — notes + tags on trades; stats per tag (win rate, avg P&L).
  Teaches disciplined trading; trivial schema.
- **Leaderboard** — since it's paper money: opt-in ranking by total return %, computed
  from snapshots. Social hook, zero risk.
- **Dividend & split handling** — EOD sources report adjusted closes; handle splits in
  lots (quantity × ratio) to keep P&L honest. A subtle-correctness feature reviewers love.
- **CSV import/export** — export trades/portfolio; import trades from a broker CSV
  (maps to your existing trade creation). Practical and easy.
- **Correlation matrix / diversification score** — pairwise correlation of held symbols
  from daily returns; heat-grid UI on the Risk page. Cheap analytics win from Phase 1 data.

### Security-brand features
- **2FA (TOTP)** — `pyotp` + QR enrollment, verify at login, recovery codes. The single
  most impressive security feature for a portfolio project.
- **Session management UI** — list active refresh-token sessions (device, IP, last used)
  with revoke buttons; builds directly on Phase 4.3.
- **New-device / new-location login alerts** — on login with unseen user_agent+IP, write
  an audit event + in-app notification (email later).
- **Per-user API keys** — hashed API keys with scopes (`read`, `trade`) so users can hit
  your API programmatically; rate-limited per key; manageable in settings. Turns the
  platform into a real "product" and doubles down on the security story.
- **Admin dashboard** — role column on users; admin-only page: user list, failed-login
  chart, biggest risk alerts, agent activity. Demonstrates authz (role-based access),
  not just authn.
- **Audit log export** — signed CSV/JSON export of a user's audit trail
  (compliance-flavored; pairs with Phase 5).

### Engineering flex
- **WebSocket push** — broadcast cache-refresh updates to connected clients
  (`fastapi.WebSocket`); the heatmap repaints live when the refresh job lands. Delayed
  data, real-time architecture.
- **PWA** — manifest + service worker on the Vite app; installable on phones.
- **Demo mode** — public read-only demo account with seeded data so visitors (and
  recruiters) can click around without registering.
- **OpenAPI polish** — `response_model` on every endpoint + examples; then generate the
  typed frontend client from the OpenAPI spec instead of hand-writing `api/*.ts`.
- **Observability** — request-ID middleware, JSON logs, a `/metrics` endpoint
  (Prometheus format), error tracking (Sentry free tier).

---

## Suggested sequencing at a glance

| Order | Phase | Why now |
|---|---|---|
| 1 | Phase 1 (EOD data) | Unblocks heatmap, charts, risk math, backtesting |
| 2 | Phase 2 (cash) | Makes the product coherent; small |
| 3 | Phase 3 (tests) | Safety net before deeper changes |
| 4 | Phase 4 (auth) | Core of the security claim |
| 5 | Phase 6 (snapshots) | Real charts; needed by risk v2 |
| 6 | Phase 5 (audit log) | Cheap after Phase 4; needed by the agent |
| 7 | Phase 7 (risk v2) | The differentiator |
| 8 | Phase 8 (sentiment) | Data source for the agent + great UI |
| 9 | Phase 9 (AI analyst) | The headline feature, now safely gated |
| 10 | Phase 10 (deploy/CI) | Make it public; backlog items as garnish |

---

## Market research — competitive gaps (2026)

Benchmarked against what users get free elsewhere: Webull Paper Trading, Investopedia
Simulator, Thinkorswim paperMoney, TradingView, and Robinhood (Strategies/Legend/Cortex).
Gaps ordered by how much they'd move this product toward parity or differentiation.

### Table-stakes gaps (competitors all have these; we don't)
- [ ] **Order types beyond market orders** — limit, stop-loss, and stop-limit orders.
  Biggest single gap: every serious simulator (Webull, thinkorswim) supports these.
  Implementation: `pending_orders` table; the nightly/hot refresh checks cached prices
  and fills triggered orders through the existing trade path. Works fine with delayed
  data if fills are marked "filled at next available quote."
- [ ] **Per-symbol price charts (candlesticks)** — competitors are chart-first; we have
  no symbol-level chart at all. `price_history_daily` (Phase 1) + TradingView's free
  `lightweight-charts` library gives OHLC candles + volume in one component.
- [ ] **Price alerts** — Webull ships these even in paper mode (already in backlog;
  promoted here since it's table-stakes).
- [ ] **Time-weighted returns vs benchmark** — Robinhood presents time-weighted return
  as the headline metric so deposits don't distort performance. Compute from Phase 6
  snapshots; show vs SPY.

### Differentiation opportunities (weak or premium-gated at competitors)
- [ ] **Trading competitions / challenges** — Investopedia's killer feature (public and
  private "games": join code, date range, leaderboard, everyone starts with the same
  cash). We have paper cash + snapshots, so this is mostly a `competitions` +
  `competition_members` table and a scoped leaderboard. Strong social/classroom hook.
- [ ] **Monte Carlo portfolio projection** — Robinhood Strategies runs Monte Carlo
  simulated future returns in-app. We have daily returns (Phase 1) — simulate 1,000
  paths off historical mean/σ and chart the 10th/50th/90th percentile fan. Very
  impressive, ~a day of work, fits the risk brand perfectly.
- [ ] **Allocation & return-driver drill-down** — Robinhood shows asset allocation and
  "top drivers of your returns." We have the data: allocation donut (by sector, from
  `market_symbols`) + "top 3 contributors / detractors this month" from snapshots.
- [ ] **Explained risk (our edge)** — no retail competitor explains *why* something is
  risky. Every risk score we show should carry its rule breakdown and a plain-English
  explanation. Lean into this everywhere: tooltips, alert cards, the AI analyst's
  rationale. This is the platform's identity — competitors have black-box scores.
- [ ] **Education layer** — Investopedia wins beginners by pairing the simulator with
  learning. Cheap version: glossary tooltips on every metric (P/E, beta, VaR, drawdown)
  and a "why this matters" line on each risk rule.

### Explicitly out of scope (documented so we stop wondering)
- Options/derivatives trading (Webull/thinkorswim have it; huge accounting complexity,
  wrong ROI for this project).
- Real-time streaming quotes (delayed data is a stated constraint; the freshness-label
  system is the honest answer).
- Market replay / tick-level backtesting (TradingView premium feature; our daily-bar
  backtester in the backlog is the right scope).

---

## UI/UX revamp plan (no code yet — design direction + audit)

**Design read:** data-dense fintech dashboard for a trust-first domain — the design
language should stay "professional terminal" (Linear/Robinhood Legend energy), not
marketing-site flashy. Current dark-slate + emerald identity is good and worth keeping;
the revamp is about *consistency, honesty, and craft*, not a new theme. Dials:
variance low (4), motion low-medium (4), density medium-high (6). The public Home page
is the one surface that can push further (it's a landing page — variance 7, motion 6).

### A. Fix the honesty problems first (highest priority)
- [ ] **Fake chart data** — `Dashboard.tsx` fabricates 1W/1M/1Y series by multiplying
  the 1D curve (`multipliers: 1.018/1.047/1.164`). This is the #1 UI issue: a risk
  platform showing invented numbers. Until Phase 6 snapshots exist, disable those
  timeframe tabs with a "coming soon" state; never render synthetic data as real.
- [ ] **Mock data fallbacks** — remove `mockData.ts` / reference-dataset fallbacks once
  Phase 1 lands; show honest empty states instead ("Cache is warming — first refresh
  runs tonight") with the freshness badge system extended everywhere a price appears.
- [ ] **Data freshness as a first-class UI element** — the backend already labels quotes
  `live-ish/delayed/cached/stale`; surface it consistently: one `FreshnessBadge`
  component (dot + relative time, tooltip with exact timestamp) on every price surface.

### B. Design-system consistency pass
- [ ] **Icons: adopt one library** — icons are currently hand-rolled SVG path dumps in
  `AppShell.tsx`. Replace with `@phosphor-icons/react` (one family, `weight="light"`,
  consistent size scale: 16/20/24). Delete all inline icon components.
- [ ] **Typography** — self-host `Geist` + `Geist Mono` (via `@fontsource` or files +
  `font-display: swap`). Mono for ALL numbers (prices, P&L, quantities) with
  `tabular-nums` so columns don't jitter as values update; sans for labels/body.
  Define a type scale (12/14/16/20/28/36) and stop using one-off `text-[10px]`-style
  arbitrary values.
- [ ] **Design tokens** — extract the palette into CSS variables / Tailwind theme
  extensions: `--bg-base #040b14`, surface tiers (base → raised → overlay), one accent
  (emerald), semantic colors (`--gain`, `--loss`, `--warn`). Rule from the design
  skills: one accent, locked across the whole app; semantic red/green reserved for
  P&L/risk only, never decoration.
- [ ] **Radius + shadow lock** — pick one corner scale (e.g. cards 16px, inputs/buttons
  8px, pills full) and one shadow recipe (soft, tinted to the bg hue — no pure-black
  drops), audit every component against it.
- [ ] **Number & date formatting** — one `utils/format.ts` used everywhere: currency
  with consistent decimals, signed percents with ±, compact large numbers (1.2M),
  relative timestamps. No component-local formatting.

### B2. Code hygiene behind the UI (composition-patterns / `/simplify`)

Found in the July 2026 skill-driven audit — structural debt that will fight every
visual change until removed.

- [ ] **Delete the dead component set** — eight files in `frontend/src/components/`
  are imported by nothing (the live versions live in `features/dashboard/components/`):
  `StatCard.tsx`, `DataTable.tsx`, `RiskBadge.tsx`, `SkeletonCard.tsx`,
  `RiskScoreCard.tsx`, `PortfolioChart.tsx`, `QuickTradePanel.tsx`, `EmptyState.tsx`.
  Verify with a grep for imports, then delete.
- [ ] **Extract a shared `riskTone.ts` module** — the thresholds (≥80 High, ≥50 Medium)
  and their color classes are independently reimplemented in `Dashboard.tsx` (~line 144),
  `features/dashboard/components/RiskScoreCard.tsx` (~line 11), and `Risk.tsx`
  (`getRiskLevel`/`getRiskTone`, ~lines 23–63). One module exporting
  `getRiskLevel(score)` + `getRiskTone(level)`; all three consumers import it.
- [ ] **Extract a `MetricTile` component** — the KPI-strip markup in `Dashboard.tsx`
  (label + value + optional tone/accent) is copy-pasted four times; fold into one
  component in `features/dashboard/components/`.
- [ ] **Fix the defeated memoization** — `Dashboard.tsx:130-134`: `baseChartPoints`
  is rebuilt every render, so the `useMemo` on `chartPoints` never caches. Memoize
  `baseChartPoints` (or fold both into one `useMemo` keyed on the query data +
  timeframe). Per react-best-practices skill.

### B3. Charts & data visualization rework (dataviz skill)

Read the `dataviz` skill before touching any chart code — it has the mark specs,
palette formula, and interaction rules these items come from.

- [ ] **`PortfolioChart` interaction** — no hover/tooltip exists at all. Add a
  crosshair + tooltip (nearest-point hit area, mono value + label, follows pointer,
  keyboard-reachable). This is table-stakes for a finance chart.
- [ ] **Fix `preserveAspectRatio="none"`** — it distorts dots and any in-SVG text at
  different container widths. Render at measured width (ResizeObserver) or keep the
  aspect ratio and letterbox.
- [ ] **Reduce mark clutter** — drop the dot on every data point; keep only the
  endpoint dot (+ hovered point). The line and area fill carry the shape.
- [ ] **Donut/gauge accessibility & spec** — `RiskScoreCard` donut SVG needs
  `role="img"` + `aria-label` ("Risk score 42 of 100, Low"); check track/progress
  contrast against the dataviz meter spec.
- [ ] **Heatmap + exposure bars on a validated diverging palette** — replace the
  ad-hoc threshold tones in `Home.tsx::getHeatmapTone` and the Risk page exposure
  bars with the skill's diverging-palette formula (run its validator); ensure a
  neutral midpoint that isn't confusable with "no data".
- [ ] **Chart as accessible table** — every chart offers its data as a visually-hidden
  or toggleable table (also listed in E; implement once here).

### C. Interaction states (the "product feels finished" layer)
- [ ] **Full state cycles on every data surface** — loading (skeletons matching final
  layout shape — partially done, make universal), empty (composed, with a CTA telling
  the user how to populate), error (inline retry button, not just a toast).
- [ ] **Tactile feedback** — buttons get `active:scale-[0.98]`, custom cubic-bezier
  transitions (already used on the sidebar — standardize: `ease-[cubic-bezier(0.16,1,0.3,1)]`,
  200–300ms), hover states on all rows/cards.
- [ ] **Optimistic trade flow** — after submitting a trade: button enters pending state,
  new trade row appears immediately (React Query optimistic update), risk score card
  animates to its new value. Currently it's toast-then-refetch.
- [ ] **Motion budget** — add `motion` (Motion/Framer) for: number count-up on metric
  tiles, chart draw-in, staggered card entrance on route change (60ms stagger, once).
  Everything gated behind `useReducedMotion`. Nothing loops infinitely except the
  existing "System live" pulse.
- [ ] **Command palette (Ctrl+K)** — search any symbol → research view, jump to pages,
  quick trade. The single highest-craft-per-effort feature for a terminal aesthetic
  (use `cmdk`).

### D. Information architecture & density
- [ ] **Dashboard hierarchy** — one primary number (total account value + day change)
  visually dominant; everything else supporting. Currently tiles compete equally.
- [ ] **Split `Home.tsx` (945 lines)** into section components; apply landing-page rules
  from the design skills: hero ≤ 2-line headline + ≤ 20-word subtext + 1 primary CTA,
  real visual (the heatmap itself is the hero asset — show the live product, not
  abstractions), max 1 eyebrow per 3 sections, no duplicate CTA intent.
- [ ] **Tables → terminal-grade** — sticky headers, right-aligned mono numerals, subtle
  row hover, sortable columns, density toggle (comfortable/compact). Consider virtualized
  rows for the universe/heatmap tables (1,000 symbols).
- [ ] **Symbol detail page** — there's market research data but no dedicated
  `/symbol/AAPL` route pulling it together: candlestick chart, fundamentals, sentiment,
  user's position + lots, trade panel, risk factors. This becomes the app's centerpiece
  page and the natural home for most Phase 7–9 UI.

### E. Accessibility (AccessLint-style audit items)
- [ ] Contrast audit — several text styles (`text-slate-600` on `#040b14`, 10–11px
  uppercase labels) are likely below WCAG AA 4.5:1; verify and lift. Check emerald-on-dark
  button text and rose/emerald P&L values against row hover backgrounds.
- [ ] Don't encode meaning in color alone — P&L and risk severity need a second channel
  (▲/▼ glyphs, badge text). Also makes the app colorblind-safe.
- [ ] Keyboard pass — visible focus rings on every interactive element (partially done),
  focus trap in the mobile sidebar, Escape closes overlays, logical tab order on forms.
- [ ] Screen-reader pass — `aria-live="polite"` on the toaster, `aria-sort` on sortable
  headers, chart data available as an accessible table alternative, form errors linked
  via `aria-describedby`.
- [ ] `prefers-reduced-motion` respected by every animation (including the ping dot).
- [ ] Touch targets ≥ 44px on mobile; keep the existing skip-link (good) and audit
  heading order (one `h1` per page).

### F. Suggested execution order
1. A (honesty) — can ship immediately, mostly deletions
2. B2 (code hygiene) — dead-code deletion + extractions first, so every later step
   touches one copy of each pattern instead of three
3. B (tokens/icons/type) — one focused PR, touches everything visually
4. B3 (charts/dataviz) — after tokens exist so chart colors come from the system
5. C (states + motion) — component-by-component
6. D (IA: symbol page + dashboard hierarchy + Home split) — alongside Phases 6–8,
   since those provide the real data these pages need
7. E (a11y) — run as a checklist audit at the end of each of the above

### G. Skill-driven workflow (which installed skill runs each step)

The repo has Claude Code skills installed for exactly this work. Standard loop for
every UI/UX PR in sections A–E:

| Step | Command / skill | When |
|---|---|---|
| 1. Baseline audit | `/scan` (accesslint) against the Vite dev server | Before starting a section — grounds issues to real DOM selectors + file:line |
| 2. Design direction | `frontend-design` (primary; don't mix with the bencium/ui-ux-pro-max skills — one source of truth) | Any visual decision: type scale, tokens, spacing, motion budget |
| 3. Chart work | `dataviz` — read BEFORE writing any chart code | All of B3, plus any new chart in Phases 6–9 |
| 4. Component structure | `composition-patterns` + `react-best-practices` | B2 extractions; any new component API |
| 5. Post-change quality | `/simplify` then `/code-review` on the branch diff | Before every commit of a UI PR |
| 6. Regression check | `diff` (accesslint) — compares live violations vs baseline | After changes: proves no new a11y violations introduced |
| 7. Guidelines sweep | `web-design-guidelines` review | Once per section as a final checklist |
| 8. Verify | `/verify` — drive the changed flow in the running app | Before merging |

Not applicable to this repo: `react-native-skills` (no mobile app).

**Definition of done for the revamp:** every number on screen is real or clearly
labeled; one icon family, one type scale, one accent; every async surface has
loading/empty/error states; keyboard-only navigation works end-to-end; `/scan`
reports zero critical violations and Lighthouse accessibility score ≥ 95.
