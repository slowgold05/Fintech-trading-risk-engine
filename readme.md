# Sentinel Markets

Sentinel Markets combines a paper-trading terminal, portfolio analytics, optional local AI research, and an experimental Kronos Forecast Lab. Orders, cash movements, and review decisions leave an audit trail, while research and forecasting remain advisory.

> Simulated cash and orders only, with no live broker connection. This is not investment advice or a compliance certification. Research notes and forecasts do not place orders or change hard risk limits.

**Merged source and the verified host are still different.** [PR 92](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/92) is merged at `a99fbd78036eb1294b880d7f8628aadd0753aae0` (same tree as reviewed release `b7ea1e103d3a294c70948cac842fee92a6a772d7`). Deployment **8** (`:fintechapp-preview.api.5`, `:fintechapp-preview.web.6`, Alembic `45d85a1871f0`) is **ACTIVATING** in `us-east-2`. It is not verified `ACTIVE`. Browser, API, cash, and order acceptance are pending, and the scheduler's final state is pending. The last verified active release remains deployment **7** (`fintechapp-preview.api.3`, `fintechapp-preview.web.4`, Alembic `f3a8c2d7e961`). Prepared facts: [9 November 2026 release record](docs/RELEASE_2026-11-09.md).

**[Hosted preview](https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com/)** · **[Preview API health](https://fintechapp-preview.gps5zt7wg4yqg.us-east-2.cs.amazonlightsail.com/api/health)** · [Control matrix](grc/control_matrix.csv) · [Security summary](Security.md)

The preview links are the existing hostname. They are not proof that deployment 8 is the version serving traffic.

## Workspaces

| Path | What it provides | Access |
| --- | --- | --- |
| `/`, `/dashboard` | Public market home or signed-in account overview | Account numbers require a session. |
| `/market` | Market discovery, daily charts, and watchlists | Public market data; private watchlists require a session. |
| `/trades` | Order preview, paper execution, fills, and cancellation | Signed in; execution role checks still apply. |
| `/portfolio` | Valuation, performance, allocation, and P&L attribution | Signed in. |
| `/risk` | Portfolio risk measures and read-only scenario previews | Signed in. |
| `/research` | SEC filings, owned research reports, and briefs | Signed in; model synthesis is opt-in. |
| `/forecasts` | Forecast jobs, results, models, and evaluation records | Signed in; Kronos inference is opt-in. |
| `/compliance` | Evidence, case reviews, access governance, and ops health | Authorized roles; trader accounts are denied. |
| `/login` | Sign-in | Public. |

The public home header has a **Log in** link to `/login` (signed-in visitors see **Open dashboard** instead). A **Get started** link also goes to `/login`. Admin and compliance-officer credentials are not published.

## Product path

1. Browse the public dashboard: cached market context, no account required.
2. Sign in. Private watchlists support multiple lists, membership, and ordering. They can prefill a research or chart draft. Trade entry from a watchlist passes only the symbol.
3. Open a cached chart, then an explicit non-binding order preview, then confirm a supported paper order.
4. Matching uses actual opposing liquidity and price-time priority, including partial fills, cancel, and buying power. Idempotency keys are required on submit.
5. Fills, open reservations, portfolio, and risk views follow from the ledger. Missing marks stay null and dependent totals stay unavailable. The app does not draw a fabricated equity curve.
6. Research Desk and Forecast Lab jobs are owned by the user. Notes, briefs, and forecasts cannot place orders or change hard risk limits.

## Charts and market data

Charts use Lightweight Charts 5.2.1: candle, line, and area series, volume, and SMA, EMA, Bollinger Bands, RSI, and MACD with configurable parameters. Ranges are `1m`, `3m`, `6m`, `1y`, `2y`, and `all`. **All** means stored available history, not guaranteed full listing coverage. Chart preferences persist. Owned execution markers and open-order price levels are drawn for the signed-in account.

The quote path is a cached provider. Adjustment policy is explicit. The standard NYSE calendar has documented coverage limits. There is no intraday feed and no claim of a continuous provider entitlement.

Cached charts and long-history portfolio metrics can be honestly unavailable. On the host, the new canonical `market_bars_daily` table is empty. No ingestion writer ships in the app. Provider ingestion stays gated on a written provider decision ([exchange-calendar verification](docs/P1C_EXCHANGE_CALENDAR_VERIFICATION.md)). The scheduler, when enabled, refreshes the legacy quote and daily cache. It does not fill canonical two-year history. This README does not claim two-year hosted coverage. Exact public data status is still to be confirmed.

## Trading, ledger, and access

Market and limit orders match against actual opposing liquidity. Partial fills, cancellation, and buying-power checks are implemented. Preview is explicit and non-binding; confirmation is a separate step.

Durable recovery for an unknown order outcome uses `sessionStorage` and is implemented for a same-tab reload. See [docs/P3B_ORDER_RETRY_DURABILITY_VERIFICATION.md](docs/P3B_ORDER_RETRY_DURABILITY_VERIFICATION.md). If that storage write fails, the recovery record is lost, so this is not a universal durability guarantee.

Existing cash locking, hash-chained ledger postings, role approval versus privileged application, MFA step-up, and review controls remain in place. Surveillance and AML rules still need independent activation. See [Security.md](Security.md) for MFA, secrets rotation, and related boundaries.

## Portfolio analytics and risk

The supported contract windows for `GET /portfolio/performance` are `1y` and `2y` only. Chart tokens such as `1m`, `3m`, `6m`, and `all` stay valid for charts and are rejected here. The endpoint reports flow-adjusted time-weighted return, daily and cumulative P&L, drawdown, an SPY price benchmark, and Modified Dietz money-weighted return. Security and sector allocation and point-in-time P&L attribution are included.

A zero-capital period returns null percentages. A defined terminal loss of 100% is still reported when that is the real result. Known cash and dollar P&L stay populated. The app does not substitute a fabricated zero return.

Risk metrics, when history is long enough, include volatility as a **sample per period** (not annualized), beta, historical VaR and expected shortfall at 95% and 99%, correlations, variance contributions, and fixed stresses. Scarce history returns unavailable or null. The risk response is composed from one clock and one snapshot. Numbers are not filled in. If canonical daily history has not been ingested, a long window can still be unavailable.

`/portfolio/trade-impact` and `/risk/scenarios` are **read-only what-ifs**. They do not execute or approve anything. Trade impact ignores fees, slippage, margin, and open-order reservations. Order preview is non-binding: it applies the pre-trade checks, submission revalidates current state, and execution is authoritative.

The 9 November review recorded these analytics issues while they were open. The later source fix and CI evidence are in [docs/RELEASE_2026-11-09.md](docs/RELEASE_2026-11-09.md). The review text itself stays the historical record: [docs/REVIEW_2026-11-09.md](docs/REVIEW_2026-11-09.md).

## Research Desk

`/research` serves a cached SEC filing index, owner-scoped jobs and reports, and daily watchlist briefs.

Optional local synthesis uses Ollama. `research_synthesis_enabled` defaults to **false**. The configured model is `qwen3:14b` and the base URL is `http://localhost:11434`, which must be reachable from the worker. The simple backend sends only source-status summaries, the company name, and a count. It does **not** send full SEC filing text, so this is not grounded or verified filing analysis.

Optional TradingAgents **v0.7.1** is listed in `requirements-research.txt`. Set `research_synthesis_backend` to `tradingagents` to use its Ollama backend. That upstream package can fetch Yahoo, SEC, and FRED itself. It is not an offline-only stack.

Worker states are `queued`, `running`, `completed`, `failed`, and `cancelled`. Cancellation applies to queued jobs only. Pending intake is capped at 10 research jobs and 5 forecast jobs per owner, serialized with an owner lock. Releasing a worker claim uses a separate source session, so a helper commit or rollback does not release that claim. True isolation of that session is an independent database connection; the PostgreSQL proof is the one that establishes it. This README does not claim a hard wall-clock bound or real-model accuracy.

Prompt tokens, completion tokens, and duration are recorded for simple Ollama research jobs and summarized in operator ops health. That is not complete model-cost accounting, and it does not bill TradingAgents or Kronos tokens. A real local Ollama call is recorded in [docs/P73_AI_USAGE_VERIFICATION.md](docs/P73_AI_USAGE_VERIFICATION.md) and the [backlog](docs/V2_BACKLOG.md). That record is not new inference proof for this review, and it is not Kronos proof.

## Forecast Lab

`/forecasts` lists owned jobs, supports cancel-while-queued, and shows results plus model metadata. The result view charts historical observed OHLC against predicted OHLC. `ForecastJob`, `ForecastResult`, and `ForecastEvaluation` are ORM models.

Kronos source is vendored. Config defaults are `NeoQuasar/Kronos-small` and Tokenizer-base (`NeoQuasar/Kronos-Tokenizer-base`). Those names are defaults, not a pinned weights revision. Default limits are lookback **400**, horizon **30**, and sample count **5**. `forecast_kronos_enabled` defaults to **false**.

`requirements-forecast.txt` is optional (PyTorch, pandas, and related packages). Hugging Face weights are not part of the default install. No real Kronos weight inference and no walk-forward validation on real weights have been verified. A local Ollama research run is not Kronos proof.

The offline walk-forward harness calls the real adapter with a session-date `as_of` cutoff (commit `1000c4d`). Tests use a fake predictor. The `as_of` filter does not reconstruct historical data vintages and still reads the latest two-year cache. That is not a full point-in-time or revision-safe backtest, and it is not validated forecast accuracy. Weight downloads, machine capacity, and vendor or model-owner review stay separate. See [docs/FORECAST_LAB_OPEN_LIMITATIONS.md](docs/FORECAST_LAB_OPEN_LIMITATIONS.md). Its historical section 4 is superseded by [docs/P6F_KRONOS_POINT_IN_TIME_VERIFICATION.md](docs/P6F_KRONOS_POINT_IN_TIME_VERIFICATION.md).

The default API image installs `requirements.txt` only. AI extras and a model server must be configured on purpose. They are outside the default CI installation and need their own dependency and model validation before use.

## Compliance controls

Four versioned surveillance detectors (wash trading, spoofing/layering, pump-and-dump, unusual volume) and two AML rules (structuring, rapid movement) stay inactive until independent activation. Evidence, reviews, and role application remain separate from the operator path. MFA and secrets rotation are described in [Security.md](Security.md). With `YENTE_URL` empty on the last documented host, sanctions screening used a local fixture, not a live OFAC or OpenSanctions list. That statement is from the deployment record, not a check performed for this README.

## Architecture reference

The images below illustrate the **last documented hosted layout**. Research and forecast services in this branch are part of the API process and the optional scheduler path. They are not proof of a deployed topology.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/sentinel-markets-stack-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/diagrams/sentinel-markets-stack.png">
  <img alt="Historical hosting diagram for the last documented Sentinel Markets release: browser, React, Nginx, FastAPI, private PostgreSQL, and an operator release path. Research and forecast extras in current source are not shown as deployed services." src="docs/diagrams/sentinel-markets-stack.png" width="1120">
</picture>

[Light PNG](docs/diagrams/sentinel-markets-stack.png) · [Dark PNG](docs/diagrams/sentinel-markets-stack-dark.png) · [Self-contained HTML](docs/diagrams/sentinel-markets-stack.html) · [Diagram sources and notices](docs/diagrams/NOTICE.md)

On that hosted layout, Nginx serves the React app and proxies `/api/` to FastAPI. PostgreSQL is private. The scheduler runs inside the API process. Schema changes used a separate temporary migration runner. Operations are in [docs/aws_deployment.md](docs/aws_deployment.md). The diagram stays the layout reference. It is not evidence that deployment 8 is active. The 9 November images and the still-activating deployment are recorded in [docs/RELEASE_2026-11-09.md](docs/RELEASE_2026-11-09.md).

| Layer | Technology |
| --- | --- |
| Web | React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, Lightweight Charts |
| API | Python 3.12, FastAPI, SQLAlchemy, Pydantic |
| Data | PostgreSQL 17, Alembic |
| Optional research | Ollama; TradingAgents via `requirements-research.txt` |
| Optional forecast | PyTorch and Kronos via `requirements-forecast.txt` and separate weights |
| Local and host packaging | Docker, Nginx, Docker Compose |
| CI | GitHub Actions, seven jobs covering tests and security |

## Verification

Merged-source CI is green. Hosted acceptance of deployment 8 is not. Counts below are separate runs. Do not add them into one total. The prepared record is [docs/RELEASE_2026-11-09.md](docs/RELEASE_2026-11-09.md). The earlier same-day review, including its open-finding verdict, stays [docs/REVIEW_2026-11-09.md](docs/REVIEW_2026-11-09.md). Historical unit logs are in [docs/V2_BACKLOG.md](docs/V2_BACKLOG.md).

| Run | Result |
| --- | --- |
| PR 92 CI [42689491609](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42689491609) | All seven jobs passed. Backend: 557 passed, 12 skipped, 174.82s. The 12 skips are 7 browser modules (Selenium not installed), 3 Kronos tests (pandas not installed), and 2 new forecast-claim PostgreSQL proofs (pandas not installed). Frontend: 417 tests in 30 files; lint and production build passed. Security jobs passed. A separate browser job: 10 passed, 1 hosted case excluded, 149.28s. |
| Merged `main` CI [42690312847](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42690312847) | All seven jobs passed. |
| Hosted deployment 8 | **ACTIVATING.** Browser, API, cash, and order acceptance are pending. |

These runs do not exercise real Kronos weights or establish forecast accuracy. They do not prove that deployment 8 is the live serving version.

## Run locally

Prerequisites: Docker Desktop, Node.js 22, and npm. Core install does not include the research or forecast extras.

```powershell
Copy-Item .env.compose.example .env.compose
```

Replace `POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, and `JWT_SECRET` with distinct random values, then start Postgres and the API:

```powershell
docker compose --env-file .env.compose up --build -d
```

In another terminal:

```powershell
Set-Location frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The API listens on **http://127.0.0.1:8000**. Interactive `/docs` is for local development only.

Compose uses its own database volume. It does not attach to the hosted database. Stop without deleting that volume:

```powershell
docker compose --env-file .env.compose down
```

Non-Compose setup and migration history: [docs/postgresql_migration.md](docs/postgresql_migration.md). Do not commit `.env` files, dumps, or account credentials.

### Tests

```powershell
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q

Set-Location frontend
npm ci
npm run lint
npm test
npm run build
```

Set `AUDIT_DATABASE_URL` only to a **fresh isolated container**. A fresh database on a shared server is not safe: some proofs `ALTER ROLE` at cluster scope. Never point them at the hosted database or a shared development instance. Optional AI extras are not required for the core suite.

## Where to read next

- [Sentinel Markets 2.0 roadmap](Sentinel_Markets_2_0_Roadmap.md) — scope of the expansion. Not every phase is complete.
- [V2 backlog](docs/V2_BACKLOG.md) — historical unit log.
- [Codex and Grok workflow](docs/GROK_CODEX_WORKFLOW.md) — how changes are scoped and reviewed.
- [Release record, 9 November 2026](docs/RELEASE_2026-11-09.md) — merged source, CI, migration, and the still-activating deployment. Hosted acceptance is pending.
- [Review, 9 November 2026](docs/REVIEW_2026-11-09.md) — dated historical findings. A banner points at the later fix status. The finding text is unchanged.
- [Security.md](Security.md) — access, MFA, secrets, and control boundaries.
- [Control matrix](grc/control_matrix.csv)
- [Forecast Lab limitations](docs/FORECAST_LAB_OPEN_LIMITATIONS.md) and [point-in-time verification](docs/P6F_KRONOS_POINT_IN_TIME_VERIFICATION.md)
- [Research extras](requirements-research.txt) · [Forecast extras](requirements-forecast.txt)
- [Hosted release runbook](docs/aws_deployment.md) — deployment 7 remains the last verified active record. The 9 November section is separate and still in progress.
- [Diagram notices and third-party marks](docs/diagrams/NOTICE.md)

## Repository map

```text
app/                  FastAPI routes, models, services, and operator scripts
alembic/              Versioned database migrations
frontend/             React client and frontend tests
tests/                Backend unit, integration, and PostgreSQL proofs
grc/                  Control matrix inputs, workpapers, policies, model inventory
docs/diagrams/        Hosted-layout diagram (historical reference) and notices
docs/                 Roadmap, review evidence, security, and the deployment runbook
requirements*.txt     Core install, plus optional research and forecast extras
```

## Limits that remain

- Paper trading only. No broker, no real funds, no compliance certification.
- Deployment 8 is activating. It is not verified active. Browser, API, cash, order acceptance, and the scheduler's final state are pending. Deployment 7 is the last verified active release.
- Cached charts and long-history metrics may be unavailable until an approved ingestion writes canonical daily bars. `market_bars_daily` on the host is a new empty table. There is no two-year hosted-history claim.
- Optional research synthesis and Kronos stay inactive on the deployment 8 specification. Enabling them is a separate decision. This README does not claim real-model inference or forecast accuracy.
- New product pages are in the merged source and in the images registered for deployment 8. That does not mean the roadmap is complete.
- The expansion was not re-audited line by line. The dated review was focused, not an exhaustive pass over the roughly thirty-thousand-line growth.
