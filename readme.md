# Sentinel Markets

Sentinel Markets is a paper-trading workspace for exploring US stocks, practicing trades with risk controls, and understanding portfolio performance. It brings market discovery, daily charts, an auditable paper-account ledger, and a Research Desk into one app, with an experimental Forecast Lab for model exploration.

> Simulated funds and orders only; no live broker connection. Research and forecasts are advisory: they cannot place orders or change hard risk limits. This is not investment advice or a compliance certification.

[Features](#flagship-features) · [Try the workflow](#try-the-workflow) · [Run locally](#run-locally) · [Data and model limits](#data-and-model-limits) · [Security](#security-and-operations) · [Documentation](#documentation)

## Flagship features

These capabilities are implemented in the merged source. Data coverage, provider access, and model configuration determine what is available in a running instance.

| Feature | What you can do and why it helps |
| --- | --- |
| **Market discovery and daily charts** | Search the S&P 500 and four index ETFs, browse a heatmap, sector context and news, and compare normalized index performance in Market pulse. Open a stock detail page for daily candles or a line chart, volume, and key stats. The signed-in chart adds SMA, EMA, Bollinger Bands, RSI, MACD, saved preferences, and your trade/order overlays to support a move from discovery to a paper-order draft. |
| **Paper trading with controls and a ledger** | Preview market or limit orders, trade on your own using simulated liquidity at a cached close, inspect partial fills, and cancel open orders. Buying-power, available-share, price-band, concentration, position-size, and trading-halt checks constrain the order path. Balanced, hash-chained [ledger postings](docs/ledger.md) make cash and position changes reconcilable. |
| **Portfolio and risk analytics** | Review valuation, cash-flow-adjusted returns, daily/cumulative P&L, drawdown, an SPY price benchmark, allocation, and attribution. Volatility, beta, historical VaR/expected shortfall, correlations, risk contributions, and stress scenarios help explain exposure. Trade-impact and custom risk scenarios are read-only what-ifs. |
| **Research Desk** | Keep user-owned research jobs, reports, and daily watchlist briefs together. Inspect price, a daily chart, SEC filings, and configured Finnhub headlines alongside optional bull/bear/synthesis/risk notes, so you can compare the generated text with source context ([Desk walkthrough](docs/P5_RESEARCH_DESK_FRONTEND_VERIFICATION.md)). |
| **Forecast Lab — experimental** | Inspect owned jobs, observed versus predicted OHLC charts, model metadata, and evaluation records. The Kronos integration is implemented but disabled by default; a recorded real inference run demonstrates execution, **not validated accuracy or approval for trading use**. |

## Try the workflow

1. **Discover:** open `/market` without an account. Search a company or compare the index ETF proxies SPY, QQQ, DIA, and IWM; open `/market/:symbol` for stock detail.
2. **Organize and investigate:** sign in or register at `/login`. Save private watchlists and open `/research` for jobs, reports, and briefs. Company news requires a session and a Finnhub key.
3. **Preview and practice:** open the paper-order ticket from a chart or `/trades`. Entry links prefill a draft; preview and confirmation are separate actions. A preview is non-binding and submission revalidates current state.
4. **Review the outcome:** inspect fills and open orders, then use `/portfolio` and `/risk` to understand performance and exposure. Missing marks or insufficient history stay unavailable rather than becoming invented numbers.
5. **Explore models separately:** `/forecasts` is an authenticated experimental workspace. Model output never authorizes a trade.

The signed-in `/dashboard` provides the account overview. `/compliance` is restricted to authorized admin, compliance-officer, and auditor roles; traders cannot enter it. Privileged credentials are not published.

The order ticket uses `/orders`. It matches opposing paper orders first in price-time order and excludes self-matching. A system counterparty can fill the remainder at a usable cached close, up to 100 shares per order per close by default. The preview shows estimated prices, counterparties and the reason any shares would remain. Open limits are rechecked when a newer dated quote arrives. See the [simulated liquidity rules](docs/SIMULATED_LIQUIDITY.md). The separate `POST /trades` endpoint obtains a price through Alpha Vantage and requires a configured key.

## Run locally

Use Docker Desktop, Node.js 22, and npm. Run these PowerShell commands from the repository root.

1. Copy the Compose environment template:

   ```powershell
   Copy-Item .env.compose.example .env.compose
   ```

   Replace `POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, and `JWT_SECRET` with independent random values. Use URL-safe random hex for the database passwords and at least 32 random characters for the JWT secret. Keep `.env` files, credentials, and database dumps out of Git.

2. Start PostgreSQL 17 and the FastAPI API:

   ```powershell
   docker compose --env-file .env.compose up --build -d
   ```

   Startup applies Alembic migrations and restricted application-role grants. Compose stores its database and evidence in dedicated volumes; it does not attach to the hosted database. The API binds to `http://127.0.0.1:8000`; interactive `/docs` is for local development only.

3. Start the React frontend in another terminal, also from the repository root:

   ```powershell
   Set-Location frontend
   npm ci
   npm run dev
   ```

   Open **http://127.0.0.1:5173**, then register or sign in at `/login` for private workspaces. The client defaults to the local API above; [frontend/.env.example](frontend/.env.example) documents the override.

4. Stop the backend while retaining the database and evidence volumes:

   ```powershell
   docker compose --env-file .env.compose down
   ```

See [container setup](docs/container_setup.md) and [non-Compose setup/migration](docs/postgresql_migration.md) for more detail. Existing databases need the migration procedure; do not treat a new Compose volume as a data migration.

### What needs configuration?

A fresh stack starts the application, not a fully populated market terminal. Cached views need ingestion, history needs a backfill, and external providers need working access and quotas. Compose enables scheduled jobs.

| Integration | Configuration and expected behavior |
| --- | --- |
| **Massive daily data** | Set `MASSIVE_API_KEY` in `.env.compose` for the default scheduled grouped-daily quote source and historical ingestion. Prices are the latest finished NYSE session close, not a real-time feed. With no key, quote refresh uses Yahoo end-of-day data; failed or missing Massive symbols can fall back to Alpha Vantage. Historical coverage is separate from quote refresh. |
| **Alpha Vantage** | Set `ALPHA_VANTAGE_API_KEY` in `.env.compose` for company overview data, quote fallback, and the separate direct-trade API's price read. Cached market prices do not guarantee executable liquidity or a provider entitlement. |
| **Finnhub news** | Add `FINNHUB_API_KEY` to `.env.compose`; Compose already forwards it. Without a usable key, company news returns an empty list with an explanatory error field. Public market news is cached separately. |
| **Local AI research** | Application settings default `research_synthesis_enabled` to false, **but the supplied Compose file sets it to true**, targets host Ollama at `http://host.docker.internal:11434`, and allows 600 seconds. It expects the default `qwen3:14b` model on that server. Docker does not install or start Ollama; an unavailable model leaves the report's AI sections unavailable. |
| **Kronos forecasts** | `forecast_kronos_enabled` defaults to false and Compose does not enable it. Real inference needs the optional [forecast dependencies](requirements-forecast.txt), separately downloaded Hugging Face weights, sufficient compute, and an explicit activation decision. The default API image installs only `requirements.txt`. |

For a coordinated historical load, the implemented commands below run in the API container using its configured key and database. They make provider calls and persist bars; they are **not required just to start the app**. Coordinate with scheduled Massive calls to avoid competing for quota.

```powershell
docker compose --env-file .env.compose exec api python -m app.scripts.backfill_massive_history
docker compose --env-file .env.compose exec api python -m app.scripts.backfill_massive_history --adjustment split_adjusted
```

Raw and adjusted bars are separate series. After a later split, the adjusted backfill also supports `--refresh-adjusted` for an atomic full-window refresh; see the [daily history contract](docs/DAILY_HISTORY_CONTRACT.md) before running it. No completed adjusted backfill is asserted here.

## Data and model limits

### Market data and analytics

- **Daily data, not intraday:** discovery defaults to S&P 500 constituents plus SPY, QQQ, DIA, and IWM. Exact ticker searches and owned holdings can expose symbols outside that featured set; public stock detail is limited to the featured set. `all` means stored available history, not guaranteed full listing coverage. A real LSE adapter is not implemented.
- **Adjustment is explicit:** stock detail prefers Massive split-adjusted history and labels its raw fallback. Market pulse requires the adjusted series and leaves an unavailable proxy blank. Quotes, portfolio performance/risk, and execution references remain raw. Split-adjusted bars are not dividend-adjusted total returns. See the [history contract](docs/DAILY_HISTORY_CONTRACT.md).
- **Metrics have defined scope:** portfolio performance supports `1y` and `2y`; chart ranges are a different contract. Volatility is sample per period, not annualized. Sparse history and undefined zero-capital percentages can return null. The SPY comparison is a price benchmark. See the [performance](docs/P4A_PERFORMANCE_CONTRACT.md) and [risk metrics](docs/P4D_PORTFOLIO_RISK_METRICS_CONTRACT.md) contracts.
- **What-ifs are estimates:** trade impact ignores fees, slippage, margin, and open-order reservations. Neither trade-impact nor risk-scenario previews execute or approve orders. Same-tab unknown-order recovery uses `sessionStorage`; a failed storage write loses that recovery record ([retry boundaries](docs/P3B_ORDER_RETRY_DURABILITY_VERIFICATION.md)).

### Research and experimental forecasting

Simple Ollama research receives source-status summaries, a company name, and a filing count, **not full SEC filing text**. Generated notes are not verified filing analysis. Optional [TradingAgents dependencies](requirements-research.txt) support a separate backend that can call Yahoo, SEC, and FRED itself; it is not offline-only. See [synthesis behavior](docs/P5D_RESEARCH_SYNTHESIS_CONTRACT.md) and the [vendor review](grc/vendors/tradingagents_data_vendors.md). AI extras need their own dependency/model review beyond the core installation's checks.

Kronos defaults to `NeoQuasar/Kronos-small` and `NeoQuasar/Kronos-Tokenizer-base`; these names do not pin a weights revision. A [recorded real inference run](docs/P9E_STAGE6_KRONOS_REAL_INFERENCE_VERIFICATION.md) established that inference was reachable. Output is widened to a consistent OHLC envelope; that does not establish prediction quality. Real-weight walk-forward evaluation, the fixed 12-stock scope decision, and model-owner approval remain unrecorded here.

The evaluation adapter applies a session-date cutoff but reads the current two-year cache; it does not reconstruct historical data vintages or establish revision-safe backtesting. Read the dated updates in [Forecast Lab limitations](docs/FORECAST_LAB_OPEN_LIMITATIONS.md) alongside [cutoff verification](docs/P6F_KRONOS_POINT_IN_TIME_VERIFICATION.md): older passages in those records are historical. No current hosted activation or forecast accuracy is claimed. Jobs support cancellation while queued; background processing and scheduler limits are not a crash-safe lease or hard wall-clock guarantee.

## Security and operations

Orders and direct trades require idempotency keys. Ledger postings balance by unit and carry a per-account hash chain; restricted application-role grants and database triggers protect them from update/delete. The migration login remains privileged. For reconciliation, run in the configured backend environment:

```powershell
python -m app.scripts.reconcile_ledger
```

For pre-ledger accounts, initialization and coverage boundaries are in the [ledger guide](docs/ledger.md). Preserve evidence and its digest outside the repository. Role changes separate request, independent approval, and privileged application; MFA enrollment/recovery and secret rotation have important limitations described in [Security.md](Security.md).

Surveillance and AML detectors require independent activation. With `YENTE_URL` empty, sanctions screening uses a local fixture, not a live OFAC/OpenSanctions list. Configured screening fails closed. Operational evidence, case review, and ops-health views support investigation; their existence is not compliance certification. See the [control matrix](grc/control_matrix.csv), [open control actions](docs/GRC_ACTION_ITEMS.md), and [security reporting policy](docs/SECURITY.md).

### Development checks

From a configured Python environment at the repository root:

```powershell
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
```

Frontend checks, from the repository root in a separate terminal:

```powershell
Set-Location frontend
npm ci
npm run lint
npm test
npm run build
```

Set `AUDIT_DATABASE_URL` only to a **fresh isolated container**. A fresh database on a shared server is unsafe: some proofs run cluster-wide `ALTER ROLE`. Never target hosted or shared development databases. Optional AI extras are not required for the core suite. Historical test counts are evidence for their named runs, not a current all-green release claim.

## Documentation

The stack is React/TypeScript/Vite, FastAPI/SQLAlchemy, and PostgreSQL/Alembic, packaged with Docker and Nginx. Research and forecast processing live in the API process/background and optional scheduler paths; optional models are separate runtime requirements.

| Read next | Purpose |
| --- | --- |
| [Product roadmap](Sentinel_Markets_2_0_Roadmap.md) · [Historical backlog](docs/V2_BACKLOG.md) | Planned scope and dated implementation evidence; neither means every phase is complete. |
| [API inventory](docs/API_INVENTORY.md) · [Daily history contract](docs/DAILY_HISTORY_CONTRACT.md) | Endpoint reference and data semantics. Older documents may describe earlier states; current source is authoritative for this checkout. |
| [Historical project review](docs/REVIEW_2026-11-09.md) · [Change workflow](docs/GROK_CODEX_WORKFLOW.md) | Review evidence and development process. The review's old range, zero-capital, risk-snapshot, and job-admission findings have subsequent fixes in this source. |
| [Hosted release runbook](docs/aws_deployment.md) · [Historical layout diagram](docs/diagrams/sentinel-markets-stack.html) · [Diagram notices](docs/diagrams/NOTICE.md) | Deployment history and operational detail, not proof of the current host's state. |

**Source versus hosted status:** this README describes merged `main` functionality; it does not include unmerged PRs [143](https://github.com/slowgold05/fintech-trading-risk-engine/pull/143) or [144](https://github.com/slowgold05/fintech-trading-risk-engine/pull/144). The last recorded hosted release is deployment 7. The [historical preview](https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com/) and [API health URL](https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com/api/health) are useful references, but current availability and parity with this source have not been rechecked.

```text
app/                  API routes, models, services, and operator scripts
alembic/              Versioned database migrations
frontend/             React client and frontend tests
tests/                Backend tests and isolated PostgreSQL proofs
grc/                  Controls, policies, workpapers, and model/vendor records
docs/                 Contracts, verification history, security, and runbooks
requirements*.txt     Core install and optional research/forecast extras
```
