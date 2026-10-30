# Project Review & Roadmap

Date: 2026-07-05

> **Step-by-step implementation plan:** see [ROADMAP.md](ROADMAP.md) — every feature
> below is broken into phases with concrete tasks, file paths, and a feature backlog.

Scope: Full review of backend (FastAPI), frontend (React/Vite), migrations, services, and docs.

---

## 1. What's genuinely good

- Clean layered backend structure: routers → services → models → schemas.
- FIFO lot accounting with realized P&L is correctly implemented (`app/routers/trades.py`).
- Market data caching design is the right architecture for free-tier data:
  tiered refresh (`hot`/`daily`), freshness labels (`live-ish`/`delayed`/`cached`/`stale`),
  SEC EDGAR fundamentals, Nasdaq universe sync.
- `docs/SECURITY_AUDIT.md` is honest and identifies real issues.
- Frontend keeps the JWT in memory instead of localStorage (good XSS posture).
- `.env` is gitignored, `.env.example` provided.
- Provider errors are sanitized so API keys can't leak into API responses.

---

## 2. The market data problem (root cause + fix)

**Root cause:** Alpha Vantage free tier allows ~25 requests/day. With a 1,000-symbol
universe and a 12-second delay per request, the heatmap takes weeks to fill.
The caching architecture is right — the provider is wrong.

Since day-old data is acceptable, better sources:

| Source | What you get | Limits |
|---|---|---|
| **Stooq** (stooq.com) | Free end-of-day CSVs for all US stocks | No API key, effectively unlimited |
| **yfinance** (Python lib) | ~15-min-delayed quotes, batch downloads | No key; unofficial / TOS gray area |
| **Finnhub** | Near-real-time US quotes | 60 req/min free |
| **Twelve Data** | Quotes + history | 800 req/day free |
| **Financial Modeling Prep** | Quotes + fundamentals | 250 req/day free |

**Recommended plan:**
1. Swap `app/scripts/refresh_market_data.py` + `price_service.py` to pull **bulk EOD
   data from Stooq or yfinance** for the whole universe nightly.
2. Keep Alpha Vantage only for on-demand `/market/research/{symbol}` calls.
3. The `market_quote_cache` table and freshness labels already support this —
   just add a new `source` value.

---

## 3. Biggest gaps

### 3.1 Zero tests
No pytest, no vitest, anywhere. For a "security-focused" platform this is the #1 gap.
Start with pytest + in-memory SQLite fixture:
- register/login flow
- buy → sell P&L math (FIFO)
- overselling rejection
- one user cannot read another user's trades/risk data

### 3.2 No cash balance / buying power
Users can "buy" unlimited stock. The app is effectively a paper-trading simulator —
lean into that:
- Add `cash_balance` to the user (start everyone at e.g. $100k).
- Deduct on buys, credit on sells, reject trades exceeding buying power.
- Gives the risk engine something real to check.

### 3.3 Auth is half-built
- **No rate limiting** on login/register — brute force is free. Add `slowapi`.
- **No refresh token** — 30-minute sessions, and the in-memory token means a page
  refresh logs the user out. Add a refresh token in an httpOnly cookie (fixes
  security and UX at once).
- `jwt_secret` defaults to `"change_me"` and the app starts anyway — make startup
  fail if the secret is default or too short.
- No password strength rules, no account lockout, no security headers middleware
  (HSTS, X-Content-Type-Options, CSP).
- Login has a user-enumeration timing leak: when the email doesn't exist,
  `verify_password` is skipped so failures return faster. Hash a dummy password
  in that branch.

### 3.4 Trade race conditions
Two concurrent sells can oversell a holding. Use `.with_for_update()` on the
holding/lots inside the transaction. Related: money math mixes `float` everywhere —
move to `Decimal` before trusting P&L numbers.

### 3.5 No audit log
A security platform should record logins (success/failure, IP), trades, and risk
triggers in an append-only table. Also a great UI feature: an "Account activity" page.

---

## 4. Leveling up the "risk" identity

The risk engine is 30 lines and two rules (trade frequency, notional > $10k).
Risk is the differentiator — this is where the interesting work is. The
`price_history` model exists but appears unused.

- **Concentration risk** — flag when one position exceeds X% of portfolio value;
  sector concentration using sector data you already have.
- **Volatility/beta-based sizing** — beta is already pulled from Alpha Vantage overview.
- **Portfolio VaR / max drawdown** from historical prices (Stooq EOD feeds this free).
- **Daily loss limits** and per-user configurable `risk_limits` table
  (already sketched in SECURITY_AUDIT.md).
- **Portfolio value history** — no way to chart portfolio value over time today
  (dashboard chart leans on mock data). Add a nightly snapshot job writing
  `(user_id, date, total_value)`; powers a real chart and drawdown calcs.

---

## 5. Smaller fixes

- `Home.tsx` is 945 lines — split into components like the rest of the frontend.
- `requirements.txt` is unpinned except `bcrypt==3.2.2` (passlib is unmaintained
  and breaks with bcrypt 4.x — consider `pwdlib` or raw `bcrypt`).
- Most endpoints return raw dicts instead of `response_model` schemas — OpenAPI
  docs undersell the API.
- No Dockerfile, no CI. Add GitHub Actions: `pytest`, `eslint`, `pip-audit`, `npm audit`.
- `/` health endpoint doesn't check the DB; add a real `/health`.

---

## 6. Priority order

1. **Swap to Stooq/yfinance EOD data** — unblocks everything visual (heatmap, charts).
2. **Cash balance + paper-trading framing** — makes the product coherent.
3. **Tests for auth + trade accounting** — before touching money math again.
4. **Rate limiting + refresh tokens + startup secret check** — best effort-to-value auth fixes.
5. **Portfolio snapshots + 2–3 new risk rules** — deepens the differentiator.
6. Audit log, Decimal migration, CI — as you go.

---

## 7. Level-up ideas (beyond fixing gaps)

Features that would take this from "solid portfolio project" to "impressive product":

### Product features
- **Watchlists** — per-user symbol lists with cached quotes; cheap to build on
  existing infrastructure.
- **Price alerts** — user sets "notify me if AAPL drops 5%"; a scheduled job checks
  cached quotes and records/e-mails alerts. Shows off background-job design.
- **Leaderboard / social** — since it's paper trading, rank users by P&L.
- **Trade journal** — let users attach notes/tags to trades; surface stats like
  win rate by tag.
- **2FA (TOTP)** — big security-brand win, well-supported by `pyotp`, and very
  demo-able in interviews.
- **Session management UI** — list active sessions/devices, revoke buttons
  (pairs naturally with refresh tokens).

### AI integration (the SECURITY_AUDIT.md plan is right)
- AI produces a **trade intent**, never a trade. Backend validates intents against
  deterministic per-user risk limits; user approves in the UI.
- Tables: `strategy_runs`, `trade_intents`, `risk_limits`.
- Full decision log: prompt/context, model output, risk checks, quote used, final action.
- This is a standout resume feature *because* of the guardrails, not despite them.

### Engineering maturity
- **Dockerize** backend + frontend, docker-compose with MySQL — one-command setup.
- **Deploy it** — a live URL (e.g. Railway/Render/Fly.io + Vercel for the frontend)
  changes how the project reads to others.
- **CI pipeline** — tests, linting, `pip-audit`/`npm audit`, and a scheduled
  dependency-update check.
- **Structured logging** (JSON logs with request IDs) + basic metrics endpoint.
- **WebSocket price updates** — even for delayed data, pushing cache updates to the
  UI live demonstrates real-time architecture skills.

### What "done" looks like
A visitor can: open a live URL → register (rate-limited, strong password, 2FA
optional) → get $100k paper cash → browse a full delayed-data heatmap → research a
stock (SEC fundamentals) → place trades with FIFO P&L → see portfolio value chart
from real snapshots → get risk alerts with explanations → view their full account
activity log. Every claim on the "security-focused" label is backed by a visible
feature or a test.
