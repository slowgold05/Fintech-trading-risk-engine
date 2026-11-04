# Sentinel Markets — Expansion Roadmap

Nov 4, 2026 · @Agnes

## Overview

Sentinel Markets grows in six phases, each adding one capability that a risk, GRC or fintech interviewer can probe: security baseline, governed market data, a validated forecasting model, a propose-only AI analyst, an automated control-testing console, and a daily risk brief.

The through-line is **governed AI in a regulated workflow**. Every AI component proposes; the deterministic risk engine and a human approver decide; every decision leaves evidence. That story is rarer and more credible in interviews than "I built a trading bot."

**Guiding principles**

- **AI proposes, rules and humans dispose.** No model output places, modifies or approves anything on its own.
- **Every control produces evidence.** If a check runs, it writes a timestamped, exportable record (the existing CSV/XLSX export is the backbone).
- **Models are inventoried and validated.** Anything predictive gets a model card, backtest, limitations and monitoring, in the spirit of SR 11-7 model risk guidance.
- **Small, testable increments.** Each phase ends with passing tests and a demoable feature.

**One correction to the other model's summary.** Kronos is trained on candlestick (OHLCV) price and volume sequences, not news-like text. Treat it as a time-series forecaster; any news or sentiment input would come from a separate component.

Assumption: this plan builds on what you've described so far (risk engine, compliance console, control export script, an AI Trading Analyst phase with human approval gates). Adjust phases that duplicate work already done.

## Status on 2026-11-04

The implemented components and reviewed audit fixes are deployed in Lightsail deployment 7. The hosted schema is `f3a8c2d7e961`, application-role grants were refreshed through a separate private runner, and the scheduler is enabled. The first cycle refreshed 180 quotes and stored evidence for 23 application controls. The runner was removed after verification. The build write-up is `docs/EXPANSION_CHANGES.md`, and the current release record is `docs/aws_deployment.md`. Live expansion-vendor connections, Kronos weights, revocation evidence, persisted data lineage, order-path data-quality enforcement, PDF/XLSX workpapers, outbound alerts, and a vendor cron stay open. Phase 0 is not closed: secret management and the provider revocation artifact remain high findings.

## Left to complete

This list is the remainder of the expansion plan. Checked boxes elsewhere in this file are already in the working tree. These items are not.

The hosted database is now Alembic `f3a8c2d7e961`; all seven release migrations are applied. The release includes the fixes for cash locking, scan cursors, wash-trade matching, sanctions parsing, authenticator consumption, AML retry, withdrawal replay, scheduler lease/due time, serialized scans, full event identities, and successive AML patterns. Container verification also corrected scoped application-role inserts. These fixes and deployment do not close the unfinished expansion integrations listed below.

### Still unwired in this tree

- Run the data-quality checks on every price load. Today they run only when a caller invokes them, and the test is the proof.
- Persist the batch checksum. `price_history_daily` has no checksum column. The checksum and the lineage record are computed in memory.
- Store an override only when an actor and a reason are present. The current override is a returned log, not a database row.
- Refuse an order for a symbol that is still blocked. Placing an order does not consult the block.
- Open a finding when the manipulation score is "unusual activity, needs review." The score does not name an account, and it does not open a finding yet.
- Add a `signal_items` table and a ticker buzz panel. The registry is `grc/signals/accounts.yaml` only.
- Add a daily-loss check on the intent path. The existing order checks were not changed, and the forecast does not change a hard limit.

### Left because it would be invented or would call a live service

- Rotate a GitHub token. This build did not find one to rotate. The known exposed secret is the Alpha Vantage key. The owner says it was revoked. The provider revocation record is not attached.
- Scan git history again and show that it is clean. That scan was not re-run.
- Run a Massive two-year backfill, open a Finnhub socket, or call Yahoo, Twelve Data, FRED, Bluesky, RSS, or SEC filings from the new adapters. Those parsers read fixtures. Empty keys do not call out. Yahoo remains the scheduler source.
- Download Kronos weights or add PyTorch. The validated model is historical volatility: 30 of 30 walk-forward hits on the fixture. Approval stays "Pending model owner review."
- Mark any of the eight signal accounts approved. `approved_by` is blank, so `review_account` fails every seed row. No DID was resolved on the network.
- Produce a PDF or XLSX workpaper. The workpaper is markdown, and the matrix is CSV.
- Add a cron, or send email, Slack, or Discord. A limit breach of 50,000 is stored on that day's brief as `risk_brief:{id}`. The narrative is a template.

### Needs a person before it can be closed

- Complete browser click-through when the browser automation service is available. Live HTTP/API smoke tests passed, but no browser-based verification is claimed.
- Attach the provider record that the exposed Alpha Vantage key was revoked.
- Accept the draft policies, the forecast model card, the vendor notes, and the asset inventory. Those stay pending owner review.
- For each signal account, supply the DID, whether it posted in the last 30 days, and the approver's name and time.
- Supply Massive, Finnhub, or Twelve Data keys only if those vendors should be connected, and accept the free-tier terms and the call volume before any backfill.
- Say if Kronos should be loaded. That needs a local checkpoint and a PyTorch dependency. Until then the weights stay out.
- Name an alert destination and explicitly allow sending. Until then a breach stays a database row.
- Say if PDF or XLSX files are required. That adds a dependency. Markdown and CSV already exist.

The next code slice that does not need those decisions is the unwired list above: persist the checksum, store the override, run the checks on load, and stop an order on a blocked symbol.

## Phase 0: Hardening and security baseline

Before adding AI, make the repo something a security reviewer would sign off on. Inspiration: **cloudflare/security-audit-skill** for the audit method, **obra/superpowers** for plan, test-first and review discipline.

**Deliverables**

- [ ] Rotate the exposed GitHub token; add a secret scanner (e.g. gitleaks) as a pre-commit hook and CI step.
- [x] `.gitignore` covers `.env`, data exports and local model files; add `.env.example` with placeholder keys only.
- [x] Branch protection on `main`: PRs required, CI must pass.
- [x] CI pipeline (GitHub Actions): lint, unit tests, dependency vulnerability scan (pip-audit or similar).
- [x] Run a structured security audit of the codebase and record findings in `docs/security/AUDIT-001.md` with severity, evidence and fix status.
- [x] `SECURITY.md` describing secret handling and how to report issues.

**Done when:** CI is green on every PR, no secrets in history, and the first audit's high-severity findings are closed.

**Interview angle:** you can show your own audit report, explain how you triaged findings, and point to the control that now prevents the token mistake from recurring.

## Phase 1: Market data layer with data-quality controls

Every later phase depends on clean prices, so build one data layer with its own controls. Inspiration: **public-apis/public-apis** (Finance and Cryptocurrency sections) for free sources.

**Deliverables**

- [x] Provider adapter interface (`MarketDataProvider`) with one primary and one fallback source, so a vendor outage does not stop the engine.
- [ ] Local store for OHLCV bars (SQLite or Parquet) with source, fetch time and checksum per batch.
- [ ] Data-quality checks that run on every load: missing bars, stale timestamps, zero or negative prices, outlier jumps, cross-source price disagreement.
- [ ] Each failed check raises a finding and blocks downstream risk calculations for that symbol until resolved or overridden with a logged reason.
- [ ] Data lineage record: for any risk number, show which bars and which source produced it.

**Done when:** a deliberately corrupted dataset is caught, logged and blocked in a test.

**Interview angle:** data integrity is a classic control objective (completeness, accuracy, timeliness). You can walk through the checks as controls with owners and evidence, not just code.

### Free whole-market data stack

No single free API gives every US stock intraday. Combine three tiers: one call per day for the whole market, a fast feed for a small watchlist, and official sources for fundamentals.

| Need | Source | Free limit | Freshness | Role |
| --- | --- | --- | --- | --- |
| Daily bars for every US ticker | [Massive (formerly Polygon) Grouped Daily](https://massive.com/knowledge-base/article/how-can-i-get-the-daily-prices-for-all-stocks-using-massives-market-data) | 5 calls/min, 2 years history ([plan](https://veryfront.com/docs/cloud/integrations/polygon.md)) | End of day | Primary universe feed |
| Near-live quotes for watchlist and portfolio | [Finnhub](https://metacpan.org/pod/Finance::Quote::Finnhub) REST + WebSocket | 60 calls/min, personal use | Near real-time | Intraday for \~50 symbols |
| Delayed quotes, broad coverage | Yahoo Finance unofficial chart endpoint ([status](https://docs.rs/crate/digdigdig3/latest/source/src/l1/free/yahoo/README.md)) | Undocumented, keep under 2 req/s | Delayed | Fallback only |
| Backup history | [Twelve Data](https://dev.to/nexgendata/best-free-stock-market-apis-and-data-tools-in-2026-a-developers-honest-comparison-1926) | 800 calls/day | Delayed | Fallback |
| Fundamentals and filings | SEC EDGAR | 10 req/s | As filed | Official source |
| Macro (rates, CPI) | FRED | Generous | Release schedule | Stress-test inputs |

**The whole-market trick.** One Grouped Daily call returns every ticker's OHLCV for a date. At 5 calls/min, backfilling 2 years (about 500 trading days) takes under 2 hours once; after that it is one call per day.

**How ai-investor-bot does it.** [Smart Stocktopus](https://github.com/agneshephzibahroche/ai-investor-bot) calls Yahoo Finance JSON endpoints with `requests`, caches results in-process, falls back to Twelve Data, pulls headlines from NewsAPI, and sets CDN cache headers so Vercel absorbs repeat traffic. It works, but it leans on an unofficial endpoint: Yahoo's v7 quote endpoint started returning 401 in January 2026 and apps had to migrate. Sentinel should use Yahoo only behind the fallback adapter.

**Making it responsive.** Pages never call a data vendor directly. Scheduled jobs write to your database; the app reads from it; API responses carry cache headers. Only the watchlist uses a live WebSocket. Page loads stay fast and you never hit a rate limit because of traffic.

**Licensing as a control.** Free tiers are mostly personal, non-professional use, and Yahoo prohibits redistribution. Keep a vendor register (source, terms, allowed use, rate limits), show delayed-data disclaimers, and prefer showing derived risk metrics over raw quote tables on the public demo. That register is a real third-party-risk artefact you can show in GRC interviews.

**Added deliverables**

- [ ] `MassiveGroupedDaily` adapter with a one-time 2-year backfill job and a daily job after market close.
- [ ] `FinnhubStream` adapter for watchlist symbols, reconnect with backoff, stays under 60 calls/min.
- [ ] Yahoo and Twelve Data adapters behind the fallback chain, with a rate limiter.
- [x] Vendor register in `docs/vendors.md`, linked from the compliance console.

## Phase 2: Kronos forecasting module under model risk management

Add **shiyu-coder/Kronos** as a forward-looking risk input, and govern it like a bank would govern a model. The governance is the impressive part, not the forecast.

**Deliverables**

- [ ] `forecast/` module wrapping a small Kronos checkpoint (sized to run on a 12 GB laptop GPU) behind a `Forecaster` interface, so it can be swapped or disabled.
- [x] Sample many forecast paths per symbol and derive risk inputs: forecast volatility band, probability of breaching a drawdown limit, simulated loss distribution for VaR-style estimates.
- [x] Risk rules can *consume* these as soft signals (e.g. tighten limits when forecast volatility spikes) but hard limits stay deterministic.
- [x] **Model inventory entry and model card**: purpose, data, version, owner, known limitations, approved uses and prohibited uses.
- [x] **Validation report**: walk-forward backtest against a naive baseline (historical volatility); calibration of the predicted bands; results stored as evidence.
- [x] **Ongoing monitoring**: track forecast error over time; alert and auto-disable the signal if it degrades past a threshold.

**Done when:** the model only feeds risk rules after its validation report passes, and the monitor can switch it off in a test.

**Interview angle:** you can discuss conceptual soundness, outcomes analysis and ongoing monitoring (the three pillars of model validation) using your own model, and explain why it is advisory only.

## Phase 3: AI Trading Analyst with propose-only agents

Borrow the agent roles from **TauricResearch/TradingAgents** (analysts, researchers debating bull vs bear, a trader, a risk team), but cut their authority: agents produce a structured trade intent, and nothing else.

&#91;embedded content: AI analyst decision flow · propose, check, approve\]

Rejections and approvals both land in the audit log, with the agents' reasoning attached.

**Deliverables**

- [x] `TradeIntent` schema (symbol, side, size, rationale, confidence, data used) validated before anything else sees it.
- [x] Two or three analyst agents (technical, risk, optionally news/sentiment) plus a bull-vs-bear debate step, running on your local model or Codex.
- [ ] Pre-trade checks in the existing risk engine: position limits, concentration, daily loss limit, Kronos volatility signal from Phase 2.
- [x] Human approval queue in the console; approver identity and timestamp recorded.
- [x] Paper trading only. No live broker credentials in the project.
- [x] Guardrail tests: prompt-injection strings in news text, malformed intents, oversized orders. All must be rejected and logged.

**Done when:** an end-to-end test shows an intent rejected by limits, another approved by a human, and both fully traceable.

**Interview angle:** this is AI governance in practice: least privilege for agents, segregation of duties between proposer and approver, and a complete audit trail.

### News and social signals feed

Sentinel gets a curated news feed and a ticker buzz panel built only on free, terms-compliant sources, with manipulation flags on top. X (Twitter) appears as link-outs only: since February 6, 2026 new developers get pay-per-use pricing with no free tier, so every post read is billed ([details](https://website-apn.pages.dev/blog/x-api-pricing-2026/)).

**Sources**

| Source | Used for | Free limits and rules |
| --- | --- | --- |
| SEC EDGAR | Main feed: 8-K and Form 4 filings | Keyless; under 10 requests/second with a contact User-Agent ([SEC](https://www.sec.gov/edgar/searchedgar/accessing-edgar-data.htm)); latest-filings Atom feed ([guide](https://dev.to/nexgendata/sec-8-k-filings-api-build-a-material-events-tracker-2026-guide-2ll3)) |
| Finnhub company news | Main feed: per-ticker headlines | Shares the 60 calls/minute free limit with price calls |
| RSS feeds | Main feed: regulators, company IR, journalists' outlets | Free, no keys |
| Bluesky `getAuthorFeed` | Main feed: curated accounts | Public host, no login; about 3,000 requests per 5 minutes ([ref](https://apify.com/gochujang/bluesky-posts-scraper)) |
| Bluesky `searchPosts` | Buzz panel: cashtag search per watchlist ticker | Use `api.bsky.app`, not the public host; about 100 posts per query without login, no paging ([details](https://apify.com/yasaslive/bluesky-scraper/changelog.md)) |

Bluesky search can't page without a login, so poll often and de-duplicate: each poll only needs posts new since the last. A free Bluesky account with an app password unlocks paged search if ever needed. Accounts that opt out of logged-out viewing are skipped, matching Bluesky's own web app.

**Pipeline**

1. **Ingest:** GitHub Actions cron jobs poll each source on its own schedule (SEC every 10 minutes, news and Bluesky every 15 to 30 minutes) and store raw items.
2. **Normalise:** one `signal_items` table (source, author, URL, text, created and fetched times, content hash).
3. **Enrich:**
   - Ticker linking from cashtags and company names in the SEC's free ticker list; bare words like "A" or "IT" never match.
   - Credibility tier: regulator filing > newswire > company IR > curated account > search result.
   - Sentiment with a lexicon scorer (VADER plus finance terms); FinBERT on the laptop as an optional upgrade.
   - Prompt-injection scan before any text reaches the Phase 3 agents; blocked items logged.
4. **Serve:** the app reads only from the database. Snippets plus a link back, never full reposts.

**Curated account registry as a control.** A table of handle, platform, tier, who added it, why and when. Additions and removals go through review and are logged, a small but concrete change-management control.

**Seed registry**

The feed launches with eight Bluesky accounts: four major outlets, Unusual Whales, and three market analysts. Two analysts are provisional until the onboarding check confirms they still post.

| Account | Handle | Tier | Status | Why |
| --- | --- | --- | --- | --- |
| Financial Times | `@financialtimes.com` | 1 · Newswire | Approved | Domain handle proves ownership; accounts it follows are verified FT staff ([pack](https://bsky.app/starter-pack/martialchartsfx.bsky.social/3lbdgopt6zt2d)) |
| Reuters | `@reuters.com` | 1 · Newswire | Approved | Domain handle; also curates Breakingviews journalists ([pack](https://blueskystarterpack.com/breaking-news)) |
| Yahoo Finance | `@yahoofinance.com` | 1 · Newswire | Approved | Domain handle; broad market news |
| Barron's | `@barrons.com` | 1 · Newswire | Approved | Domain handle; investing news |
| Unusual Whales | `@unusualwhales.bsky.social` (`did:plc:7l75ck5g4b5k6gxqaq5rejit`) | Curated | Approved | Verified, \~85K followers, posting as of Oct 2026 ([profile](https://blueskydirectory.com/profiles/unusualwhales.bsky.social)); show only ticker-linked posts, since it also posts politics |
| Ben Carlson | `@bencarlson007.bsky.social` | Curated · Analyst | Approved | Data-driven, low-hype long-term market context; active in 2026 ([posts](https://bushdrum.com/bsky/martinwiliam.bsky.social)) |
| Helene Meisler | `@hmeisler.bsky.social` | Curated · Analyst | Provisional | Well-known market breadth and sentiment analyst; recent activity not yet confirmed ([pack](https://blueskystarterpack.com/starter-packs/@lismc.bsky.social/stock-traders-3lbmupuppc32n)) |
| Walter Deemer | `@walterdeemer.bsky.social` | Curated · Analyst | Provisional | Veteran technical analyst; recent activity not yet confirmed |

The working-tree file `grc/signals/accounts.yaml` leaves `approved_by` blank, so `review_account` does not pass these rows. The statuses in the table above are the plan. They are not an operating approval, and no account was confirmed on the network.

**Considered and not added**

- **Michael A. Gayed, CFA** (`@leadlagreport.bsky.social`): active, but posts are mostly links to his paid newsletter and he promotes ETFs he manages ($RORO, $JOJO) ([profile](https://oauth.lightnews.app/bsky/leadlagreport.bsky.social?tab=media)). Excluded as promotional with a conflict of interest; a good worked example of the conflict-of-interest check.
- **Watcher.Guru** (`@watcher.guru`): Bluesky account looks dormant; X access is paid. Shown as a link-out only.
- **"Investing.com" look-alike**: self-described parody account. Rejected.
- **@unusualwhalec.bsky.social**: impostor copying the Unusual Whales bio. Rejected; the registry keys on DIDs so it can never match.
- **Charlie Bilello, Barchart, Bob Elliott**: good candidates; add once their exact handles are confirmed.

**Onboarding checklist for any new account**

- [ ] Resolve and store the DID, not just the handle.
- [ ] Identity: domain handle or a clear link from the person's or firm's website.
- [ ] Posted in the last 30 days, and mostly about markets.
- [ ] Conflict-of-interest check: sells products it promotes? Disclose or exclude.
- [ ] No look-alike or parody flags.
- [ ] Record who approved it and when.

**Manipulation flags (buzz panel)**

Four explainable signals per ticker, combined into one score:

1. **Mention spike:** mentions this hour against the ticker's 7-day average.
2. **Coordination:** near-identical posts from several accounts in a short window.
3. **Suspicious accounts:** a high share of mentions from very new or historyless accounts.
4. **Small, thinly traded stock:** cross-checked against Massive daily data, since pump-and-dump schemes target these.

Several signals at once raise an alert labelled "unusual activity, needs review", with evidence attached. It never triggers an action and it opens a finding in the Phase 4 workflow. Wording never accuses a named account.

**Staying free**

- Bluesky: 50 tickers every 15 minutes is about 200 searches an hour, far under the limit.
- Finnhub news: 50 tickers every 30 minutes is about 100 calls an hour, leaving room for prices.
- GitHub Actions: unlimited minutes on public repos; private repos get a monthly allowance (around 2,000 minutes), which a job every 15 minutes around the clock would exceed. Make the repo public, poll only in market hours, or poll every 30 minutes.

**Build order and deliverables**

- [ ] SEC filings and Finnhub news for the watchlist.
- [ ] Curated Bluesky accounts and RSS feeds, with the account registry.
- [x] Enrichment: ticker linking, sentiment, credibility tiers, injection scan.
- [ ] Ticker buzz panel on Bluesky search.
- [ ] Manipulation flags feeding Phase 4 findings.
- [x] Adapter health checks: a failing source shows "source unavailable" instead of breaking the page.
- [ ] Optional later: an X adapter behind a hard monthly budget cap, enforced as a control.

**Interview angle:** safe handling of untrusted external content before it reaches an AI system, plus market-abuse surveillance, are both live problems for security, compliance and risk teams. A raw Twitter feed is a consumer feature; this is a control framework.

## Phase 4: Compliance console and control-testing evidence runner

Turn the controls built in Phases 0 to 3 into a testable control library, and let the console prove they work. This extends the CSV/XLSX export work already in `export_controls.py`. Inspiration: the phased, evidence-first method in **cloudflare/security-audit-skill**.

**Deliverables**

- [x] Control library (YAML or DB table): ID, objective, owner, frequency, test procedure, mapped framework references (e.g. SOX ITGC, NIST CSF, SR 11-7 for model controls).
- [x] Evidence runner: executes automated tests per control on a schedule (data-quality checks, limit checks, approval-log completeness, model monitor status) and stores results with timestamps and hashes.
- [x] Findings workflow: failed test creates a finding with severity, owner, due date and remediation status.
- [ ] Workpaper export: per-control CSV/XLSX and a PDF summary an auditor could read.
- [x] Console views: control status dashboard, open findings, evidence history per control.

**Done when:** a deliberately broken control (e.g. an approval with no approver ID) fails its test, opens a finding, and appears in the exported workpaper.

**Interview angle:** you can explain test of design versus test of operating effectiveness, and show automated continuous control monitoring rather than screenshots in a spreadsheet.

## Phase 5: Daily risk brief and alerting

A scheduled morning brief ties every phase together into one artifact a reviewer can read in two minutes. Inspiration: **ZhuLinsen/daily\_stock\_analysis** for the scheduled LLM-written report pattern (check its README for current scope).

**Deliverables**

- [ ] Scheduled job (cron or GitHub Actions schedule) that runs after market data loads.
- [x] Brief contents: portfolio exposure and limit utilisation, Kronos volatility outlook, intents proposed and their outcomes, control test failures and open findings.
- [x] The LLM writes the narrative only from computed numbers passed to it; every figure in the brief is traceable to a stored result.
- [ ] Alerts (email, Slack or Discord webhook) for limit breaches, failed controls and model monitor trips.
- [x] Brief archived as evidence alongside the control results.

**Done when:** a seeded limit breach produces an alert and appears in that day's brief with a link to its evidence.

**Interview angle:** this is the management-reporting layer. You can talk about risk appetite, escalation paths and keeping AI-written summaries grounded in verified numbers.

## Keeping it free to host

The whole roadmap can run at $0 if heavy work happens on a schedule or on your laptop, and the public app only reads precomputed results.

| Part | Free option | Watch out for |
| --- | --- | --- |
| Web app + API | Vercel, Render or Hugging Face Spaces (Docker) | Vercel's Python functions are capped at 250 MB, so no TensorFlow or PyTorch at runtime ([example](https://github.com/agneshephzibahroche/ai-investor-bot)) |
| Database | Neon or Supabase free Postgres | Storage caps: keep daily bars, not tick data |
| Scheduled data jobs | GitHub Actions cron | Keep jobs short; free minutes are limited on private repos |
| Kronos forecasts | Run nightly on your laptop GPU, upload results to the database | No free GPU hosting; the app only displays stored forecasts |
| LLM agents and daily brief | Local model via Ollama, run on your laptop | The public demo shows saved runs, not live agent calls |

Free tiers change often, so check each provider's current limits before you commit, and record them in the vendor register.

**Demo tip:** seed the public app with a frozen, clearly labelled demo dataset so it always works for recruiters, even if a free API is down.

## Sequencing, build workflow and interview pitch

Build in order: each phase's controls become inputs to the next, and Phase 4 tests everything built before it.

&#91;embedded content: phase sequence · 6 phases\]

If time is short, Phases 0, 3 and 4 alone still tell the full governed-AI story; Phase 2 adds the most technical depth.

**Who does what (Codex plans, Qwen builds)**

| Step | Tool | Output |
| --- | --- | --- |
| Break a phase into small steps with tests | Codex | `PLAN.md` with numbered steps and acceptance tests |
| Implement one step at a time, no commits | Qwen Code (local) | Uncommitted changes + note in `CHANGES_FOR_REVIEW.md` |
| Review the diff, fix, commit | Codex | Clean commit per step |
| Hard parts: agent orchestration, model validation maths, security fixes | Codex | Direct implementation |

**Interview pitch (30 seconds)**

Sentinel Markets is a trading risk engine where AI can only propose. Agents and a forecasting model feed a deterministic risk engine; humans approve; every control is tested automatically and leaves auditable evidence. I can walk you through the model validation, the control library and an audit finding I fixed in my own code.

**Open questions**

- What does the risk engine compute today (VaR, exposure, limits)? That decides how much of Phase 2 plugs in directly.
- Which market data source is in use now, and does it allow storing data locally?
- Is the compliance console a web UI already, or still scripts and exports?
