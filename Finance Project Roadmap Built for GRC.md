# Finance Project Roadmap: Built for GRC

Oct 28, 2026 · @Agnes

## The pitch

Turn the trading API into a mock brokerage that is run like a regulated firm: every safeguard is a numbered control with an owner, a test and evidence, and you can prove each one works. Working name: **Sentinel Markets**, a sibling to GRC Sentinel.

GRC hiring managers at banks and fintechs rarely see a candidate who has designed, tested and evidenced controls on a real system. Most portfolios show either a security tool or a policy document. This project shows the whole loop: risk, then control, then test, then evidence, then audit.

The design premise, one line to repeat in every README and interview:

> Every movement of money is explainable, every control is tested, and nothing changes without leaving proof.

How the two flagships divide the work:

|  | GRC Sentinel | Sentinel Markets |
| --- | --- | --- |
| Role it shows | The governance platform | The governed firm |
| Core question | Which controls apply, and is there evidence? | Do the controls actually operate? |
| Skills shown | Applicability, mapping, policy, AI governance | Control design and testing, surveillance, audit evidence, model risk |
| Link | Monitors Sentinel Markets' repo and imports its evidence | Exports a control matrix and evidence Sentinel can ingest |

## What finance GRC teams do, and what you build for each

Every feature should exist because a GRC activity needs it. If a feature doesn't map to a row below, it's a nice-to-have.

| GRC activity | What it looks like at a bank or fintech | What you build in Sentinel Markets |
| --- | --- | --- |
| Control design and testing | Controls with IDs, owners, frequency, and test steps. SOX IT general controls cover access, change management and operations. | A control library in code. Each control has an automated test that writes immutable evidence. |
| Access management | Least privilege, joiner/mover/leaver process, quarterly access reviews, segregation of duties | Roles (trader, analyst, compliance officer, admin, auditor), an access-review workflow, and segregation-of-duties rules enforced in the database |
| Change management | Every production change is approved, tested and traceable | Branch protection, required reviews and CI gates, exported as change-management evidence |
| Risk assessment (RCSA) | Business units rate inherent risk, control effectiveness and residual risk | A risk register linked to controls, with residual risk recalculated from live test results |
| Key risk indicators | Metrics with thresholds that trigger escalation | A KRI dashboard: failed logins, alert backlog, open exceptions, reconciliation breaks |
| Issue management | Findings with owners, due dates, remediation plans and risk acceptances | Issues and exceptions raised automatically from failed control tests, each with an expiry |
| Model risk management | Inventory, validation and monitoring of every model, including fraud and AML models | Detection rules and the LLM treated as models: an inventory, backtests, independent approval and drift monitoring |
| Third-party risk | Due diligence and monitoring of vendors | A vendor register for your real providers (Alpaca, Massive, OpenSanctions) with data-flow and risk ratings |
| Incident response and notification | Playbooks, regulator and customer notification clocks | Incident cases with notification timers and a post-incident review template |
| Internal audit support | Evidence requests, walkthroughs, sampling | A read-only auditor role and evidence export, the same pattern as Sentinel's Audit Hub |

The app enforces the **three lines of defense**: the trading desk (1st line) owns the controls, compliance (2nd line) oversees and approves, and the auditor role (3rd line) can only read and sample.

## Regulations and frameworks to map to

Map each control to the rules below, citing the specific section where you can. Cover both the US and Singapore, because your profile lists Singapore and MAS-regulated firms hire for exactly this.

| Rule or framework | Who it binds | What it asks for | Where it shows up in the project |
| --- | --- | --- | --- |
| [SR 26-2, model risk management](https://www.federalreserve.gov/supervisionreg/srletters/sr2602.htm) | US banks (Fed, OCC, FDIC). Issued 17 April 2026; replaces SR 11-7 and SR 21-8 on BSA/AML models. | Risk-based model inventory, validation and monitoring | Detection rules as inventoried, validated models. SR 26-2 puts generative AI outside its formal scope ([Moody's](https://www.moodys.com/web/en/us/insights/banking/from-sr117-to-sr262-managing-model-risk-when-models-dont-stand-still.html)), so govern the LLM drafter under the MAS AI guidelines instead. |
| SEC Rule 15c3-5 (Market Access Rule) | US broker-dealers | Pre-trade risk controls: credit and capital limits, blocking erroneous orders | Pre-trade checks that reject orders and log which control fired |
| [SEC Regulation S-P, as amended](https://datamatters.sidley.com/2026/04/30/u-s-sec-regulation-s-p-compliance-deadline-approaching-for-smaller-entities/) | Broker-dealers and advisers. Compliance from 3 Dec 2025 (larger) and 3 Jun 2026 (smaller). | Incident response program, customer notice, service-provider oversight | Incident cases, notification timers, vendor register |
| [NYDFS 23 NYCRR Part 500](https://www.hlc.com/en/publications/nydfs-final-set-of-cybersecurity-requirements-under-amended-part-500-take-effect-november-1-2025) | NY-licensed financial firms | MFA for all users and a maintained asset inventory (both in force since 1 Nov 2025), annual certification by 15 April | Passkeys and MFA for every role, an asset inventory, a certification-readiness report |
| GLBA Safeguards Rule (16 CFR 314) | US non-bank financial firms | Written security program, risk assessment, encryption, MFA | Policy set, risk register, encrypted PII |
| SOX Section 404, IT general controls | US public companies | Access, change management and IT operations controls over financial reporting | Access reviews, change evidence, ledger reconciliation |
| Bank Secrecy Act, AML and OFAC | US financial institutions | Customer identification, transaction monitoring, Suspicious Activity Reports, sanctions screening | AML rules, sanctions screening, the LLM draft of Suspicious Activity Report narratives |
| MAS Technology Risk Management Guidelines | Singapore financial institutions | Governance, secure development, access control, cyber resilience | Second mapping column on the control matrix |
| [MAS Guidelines on AI Risk Management](https://www.mas.gov.sg/news/media-releases/2026/mas-sets-out-supervisory-expectations-on-responsible-ai-adoption-by-financial-institutions) | Singapore financial institutions. Issued 7 Oct 2026; effective 7 Oct 2027. | AI inventory, risk materiality, lifecycle controls, accountability for third-party AI | Governing the detection models and the LLM drafter; bridges to GRC Sentinel |
| NIST CSF 2.0 and SOC 2 | Voluntary, often required by contract | Common control baselines | The crosswalk layer, reusing GRC Sentinel's SCF mappings |

Talking point: SR 26-2 replaced 15-year-old guidance six months ago, and the MAS AI guidelines are three weeks old. Building to them shows you follow the field, not just textbooks.

## Security changes

The current code has 16 security issues, and two of them are urgent: a leaked API key and a default JWT secret the app will start with. All the critical and high items are Phase 0 work, before any new features.

There's also a GRC problem behind several of these. `Security.md` claims trades are immutable and the system is auditable, but nothing enforces either one. In GRC, a documented control that doesn't operate is a finding. The rule from now on is that every claim in the docs must point to a control test that proves it.

### Fix in the current code

Sorted by severity. Critical and high items are all Phase 0.

| Severity | Issue | Where | Fix |
| --- | --- | --- | --- |
| Critical | Alpha Vantage API key hardcoded in an error message, public in git history | `services/price_service.py` | Revoke the key, purge history with `git filter-repo`, add Gitleaks as a pre-commit hook and in CI |
| Critical | App starts with the default JWT secret `change_me`, so anyone can forge tokens | `core/config.py` | Fail at startup if the secret is the default or under 32 bytes. Load it only from the environment. |
| High | Two concurrent sells can both pass the holdings check and oversell (a race condition) | `routers/trades.py` | Lock rows with `SELECT ... FOR UPDATE`, and add database check constraints so quantities can never go negative |
| High | Execution prices are randomly altered by up to 0.5% | `services/price_service.py` | Remove the jitter. Store the price source, quote time and request ID with every fill. |
| High | No rate limit or lockout on login, so credential stuffing is possible | `routers/auth.py` | Rate-limit by IP and by account, lock out with backoff, log every failed attempt |
| High | Money is stored and calculated as floats | `models/lot.py`, `models/trade.py`, all services | `Decimal` in code, `Numeric` in the database, with explicit rounding rules |
| High | "Trades are immutable" is claimed but not enforced | Database | Revoke `UPDATE` and `DELETE` on ledger tables from the app's database role, and hash-chain the rows |
| Medium | `/risk` crashes on every call (undefined `current_user`) | `routers/risk.py` | Fix it, and add a test for every endpoint, including unauthenticated and wrong-user cases |
| Medium | Any string becomes a new asset, and each one triggers a paid API call, so it's an easy denial of service | `routers/trades.py` | Validate symbols against the ticker universe *before* any external call. Use enums for `side` and `asset_type`. |
| Medium | Provider error responses are returned to the client | `services/price_service.py` | Return a generic error; log the details server-side only |
| Medium | Token handling is inconsistent: expiry is 30 minutes in config and 60 in code, no issuer or audience, no revocation | `core/security.py` | One config source, short-lived access tokens with rotating refresh tokens, `iss`/`aud`/`jti` claims and a revocation list |
| Medium | `python-jose` and `passlib` are barely maintained. `passlib` breaks on modern `bcrypt`, which is why `bcrypt` is pinned to an old release. | `requirements.txt` | Switch to PyJWT and Argon2id password hashing |
| Medium | Dependencies are unpinned | `requirements.txt` | A lockfile (uv, as in Sentinel), pip-audit in CI, Dependabot |
| Low | Registration reveals whether an email is already registered | `routers/auth.py` | Return the same response either way, and send the real outcome by email |
| Low | Default database credentials `root:root` in code | `core/config.py` | No default; a least-privilege database role for the app and a separate one for migrations |
| Low | No audit log, no security headers, and Swagger docs exposed in every environment | `main.py` | Structured, append-only audit log of logins, orders and admin actions. Security headers. Docs off in production. |

### Security architecture to build

| Area | What to build | Phase |
| --- | --- | --- |
| Threat model | A STRIDE threat model and data-flow diagram, written before the rebuild and updated each phase. Reuse Sentinel's `THREAT_MODEL.md` format. | 0 |
| Supply chain | Lockfile, SBOM, pip-audit, Dependabot, Bandit, Semgrep, Gitleaks, branch protection with required reviews | 0 |
| Containers | Non-root, minimal images, scanned with Trivy in CI | 0 |
| Data integrity | Hash-chained, append-only ledger. Database role cannot update or delete. Nightly reconciliation. | 1 |
| Authorization | Role-based access for trader, analyst, compliance, admin and auditor. Object-level checks on every endpoint, with automated tests that one user can't read another's data (OWASP API Top 10, risk 1). | 2 |
| Segregation of duties | Enforced by database row-level security, not only by the UI | 2 |
| Order safety | Idempotency keys on order submission, so a retried request can't place a trade twice | 2 |
| Authentication | MFA for every role, login risk scoring, step-up authentication, passkey signing of large orders, session revocation | 4 |
| Sensitive data | Envelope encryption of personal data with key rotation, and redaction in logs. Reuse Sentinel's crypto module. | 5 |
| Dynamic testing | OWASP ZAP baseline scan in CI, plus the attack simulator as an ongoing purple-team test | 6 |

Each row becomes a control in the matrix, with its own test and evidence. The security work and the GRC work are the same work.

## Phased roadmap

Seven phases over about 21 weeks. Each one ships working code and a GRC artifact. Phases 0 to 2 are the minimum to call this a flagship.

&#91;embedded content: Build plan · 7 phases, 2 gates\]

The first gate (accent) is the one to hit: by Dec 27 the project is demoable and resume-ready, with a live control matrix.

### Phase 0: Foundation and fixes

- **Build:** revoke the leaked Alpha Vantage key and purge it from git history. Move to PostgreSQL and `Decimal`. Fix the `/risk` crash, the random price jitter and the oversell race. Fix every critical and high item in Security changes. Add the threat model, pytest, Docker Compose, and CI with Gitleaks, Bandit, Semgrep, pip-audit and Trivy.
- **GRC output:** the first two controls, for change management and secrets management, with CI runs as evidence. Write up the leaked key as your first incident postmortem. It's a real story, and handling it well is exactly what interviewers want to hear.
- **Done when:** CI is green and Gitleaks passes on the full history.

### Phase 1: Ledger, matching engine and market data

- **Build:** an append-only, hash-chained double-entry ledger. Limit and market orders, an order book with price-time priority, and cancellations. The market-data worker and nightly reconciliation.
- **GRC output:** controls for ledger integrity, reconciliation and stale-price detection. Vendor risk assessments for Alpaca and Massive.
- **Done when:** property-based tests show the ledger always balances and every position reconciles to it.

### Phase 2: Control framework and compliance console

- **Build:** a control runner that executes each control's test and writes evidence. Pre-trade controls: buying power, position and concentration limits, a price band against fat-finger orders, and a kill switch. Roles and segregation of duties enforced by the database. Compliance console v1.
- **GRC output:** control matrix v1 (about 20 controls, mapped), the risk register, and the access-control and change-management policies.
- **Gate, resume-ready MVP:** live demo, README top section, and a control matrix export.

### Phase 3: Surveillance and model risk

- **Build:** detection rules as versioned YAML (wash trading, spoofing and layering, pump-and-dump, unusual volume). A backtest harness on replayed and simulated data. Case management with SLAs. Activating a rule needs a second approver.
- **GRC output:** the model inventory, a validation report per rule following SR 26-2 principles, and the model risk policy.
- **Done when:** every rule's report shows precision and recall on labeled data.

### Phase 4: Identity and access

- **Build:** MFA for every role, login risk scoring (new device, impossible travel, credential stuffing) with step-up authentication, passkey signing of large orders, and a quarterly access-review workflow.
- **GRC output:** evidence for NYDFS 500.12 (MFA) and 500.13 (asset inventory), and the first completed access review.

### Phase 5: AML, sanctions and incidents

- **Build:** deposits and withdrawals with AML rules (structuring, rapid movement of funds) scored against AMLSim data. Sanctions screening with yente at onboarding and on payouts. Incident cases with notification timers.
- **GRC output:** the AML and sanctions policy, the incident response plan, and its mapping to amended Regulation S-P.

### Phase 6: Simulator, auditor view and polish

- **Build:** the attack simulator (credential stuffing, token replay, IDOR, the double-sell race, wash-trading and spoofing bots), mapped to MITRE ATT&CK. An LLM that drafts Suspicious Activity Report narratives citing only the case's event IDs, with a verifier. The auditor view and evidence export. GRC Sentinel monitoring this repo.
- **GRC output:** the tabletop exercise report, testing workpapers for 5 key controls, and the complete artifact pack.
- **Gate, flagship complete:** 2-minute video, polished README, and the full pack.

## The GRC artifact pack

A `/grc` folder in the repo holds the documents a GRC team would produce for this firm. Without it, Sentinel Markets reads as an engineering project. With it, it reads as GRC work.

Every control is defined once as code, and the matrix, tests and evidence are generated from that one definition. One example:

```yaml
id: SM-AC-03
title: Segregation of duties on alert closure
objective: A user cannot close a surveillance alert on their own trading activity.
type: preventive, automated
owner: Head of Compliance (2nd line)
frequency: continuous; evidence sampled quarterly
test: tests/controls/test_sm_ac_03.py
evidence: evidence/SM-AC-03/<run-id>.json
mappings:
  sox_itgc: access
  nydfs_500: "500.7"
  mas_trm: "9.1"
  nist_csf_2: PR.AA-05
risks: [R-07 insider conceals manipulation]
```

What goes in the pack:

| Artifact | What it contains | Format |
| --- | --- | --- |
| Control matrix | Every control: ID, objective, type, owner, frequency, test, evidence, regulatory mapping. Aim for 30 to 40 controls. | YAML source, CSV and XLSX export |
| Risk register and RCSA | 15 to 20 risks with inherent rating, linked controls and residual rating driven by live test results | YAML plus a dashboard view |
| Policy set | Information security, access control, change management, incident response, AML and sanctions, model risk, third-party risk, data retention | Markdown. Draft them with GRC Sentinel and note that you did. |
| Model inventory and validation reports | One report per detection rule: purpose, data, backtest precision and recall, limitations, approver, review date | Generated from the backtest harness |
| Control testing workpapers | Test of design and test of operating effectiveness for 5 key controls, with sample selection and results | Markdown, written like an auditor's workpaper |
| Vendor risk assessments | Alpaca, Massive and OpenSanctions: data shared, criticality, concentration risk, exit plan | Markdown |
| Key risk indicators | Each metric, its threshold, its owner and the escalation path | YAML plus the live dashboard |
| Tabletop exercise report | An attack-simulator run written up as an incident exercise: timeline, notification clocks, lessons learned | Markdown |
| Audit evidence export | A dated, hashed bundle an auditor can verify offline | ZIP from the auditor role |

The control testing workpapers and the model validation reports matter most. Few candidates show either, and both are daily work in finance GRC.

## Tech stack, data and UI

Match GRC Sentinel's stack, so you reuse your own patterns and the two projects look like one portfolio.

| Layer | Choice | Why |
| --- | --- | --- |
| API | FastAPI, Pydantic v2, SQLAlchemy 2 | Keeps the current code; same as Sentinel |
| Database | PostgreSQL 16 with row-level security | Replaces MySQL. Append-only ledger tables, database-enforced segregation of duties. |
| Money | `Decimal` everywhere, double-entry ledger | Fixes the float and race-condition bugs at the root |
| Background jobs | A worker for market data, reconciliation and nightly control tests | Keeps data-provider calls out of user requests |
| Front end | Next.js 15, Tailwind, shadcn/ui, Sentinel's design tokens | Reuse what already works for you |
| Charts | [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) | Free, open source, and makes a trading UI look real |
| Sanctions | Self-hosted [OpenSanctions yente](https://www.opensanctions.org/docs/yente) | Real screening data, no fuzzy-matching code of your own |
| AML test data | [IBM AMLSim](https://github.com/IBM/AMLSim) | Labeled laundering patterns, so detection can be scored |
| CI and security | pytest, Hypothesis, Ruff, Bandit, Semgrep, Gitleaks, pip-audit | Same gates as Sentinel |

**Market data plan.** No user request ever calls a provider. A single ingestion worker writes prices to your database on a schedule.

- **Live prices for a \~30-symbol watchlist:** [Alpaca](https://docs.alpaca.markets/docs/about-market-data-api) free plan (real-time IEX data, 200 calls a minute, 30 streamed symbols).
- **Daily closes for every other ticker:** Alpaca historical bars, with [Massive](https://massive.com/knowledge-base/article/on-the-free-basic-plan-when-can-i-pull-the-previous-trading-days-data) as a backup.
- **The ticker universe:** Alpaca's assets endpoint or the SEC's `company_tickers.json`, refreshed nightly.
- **Crypto around the clock:** Coinbase's public feed, so demos work outside market hours.
- **Replay mode:** record a real trading day and play it back. It makes tests and the detection scorecard reproducible.

The matching engine sets traded prices. Real data is a reference price that simulated market makers quote around, so all \~10,000 tickers can trade.

**UI.** Build two screens well rather than ten screens badly:

1. **Trading desk:** chart in the center, order book on the right, order ticket below it, positions and orders along the bottom.
2. **Compliance console:** alert queue, case view with an event timeline, control-test status board, KRI tiles, and the live attack feed when the simulator runs. This screen is the one GRC interviewers will care about.

Add a third, read-only **auditor view** last, reusing the Audit Hub layout from Sentinel.

## How to present it

A recruiter gives a repo about 30 seconds, so the top of the README has to carry the whole pitch.

**README, top five lines:** the one-line premise, a GIF of the compliance console catching an attack, then three links: live demo, 2-minute video, control matrix. Architecture and setup go further down.

**The 2-minute video:**

1. 0:00 to 0:15: "This is a mock brokerage run like a regulated firm." Show the trading desk.
2. 0:15 to 0:50: Start the attack simulator. Credential stuffing triggers step-up authentication, and a wash-trading bot raises an alert.
3. 0:50 to 1:20: Compliance console. Open the case, show the event timeline, and show that the trader can't close their own alert (segregation of duties).
4. 1:20 to 1:45: Edit a ledger row directly in the database. The tamper check fails, and a control-test failure becomes an issue.
5. 1:45 to 2:00: The control matrix and model validation report, mapped to SR 26-2, NYDFS and MAS.

**Resume bullets.** Fill in the brackets with your real numbers once they exist. Never estimate them.

- Designed and automated \[N\] controls for a mock brokerage, mapped to SOX ITGC, NYDFS Part 500 and MAS TRM, with immutable evidence from every test run.
- Built a backtesting harness for \[N\] market-abuse and AML detection rules, validated under SR 26-2 principles; wash-trading detection reached \[X\] precision and \[Y\] recall on \[N\] labeled trades.
- Implemented a hash-chained double-entry ledger and nightly reconciliation that detects any direct database tampering.
- Wrote control-testing workpapers (test of design and operating effectiveness) and model validation reports for internal-audit-style review.

**Interview stories to prepare** (situation, action, result):

- A control test that failed, and how the failure became a tracked issue with an owner and an expiry.
- Why the LLM only drafts Suspicious Activity Report narratives and never decides to file one.
- A detection rule you rejected because the backtest showed too many false positives, and what that costs an analyst team.
- How SR 26-2 changed model validation, and why you still governed the LLM under MAS's guidelines.
- The trade-off between blocking a trade before execution and flagging it afterward.

## Timeline and what to cut

At about 10 to 12 hours a week alongside classes, the plan above takes roughly 21 weeks, finishing in late March 2027. You graduate in 2027, so full-time recruiting is happening now. That makes the end of Phase 2 the deadline that matters: it's the first version worth putting on your resume.

**If time runs short, cut in this order (first to go at the top):**

1. The LLM drafter for Suspicious Activity Report narratives. It's a strong talking point, but GRC Sentinel already shows the same skill.
2. The adversary simulator's API attacks. Keep only the financial-abuse bots.
3. Passkey transaction signing. Plain MFA still covers NYDFS 500.12.
4. Crypto and replay mode. Use end-of-day stock data only.

**Never cut:** the control matrix, the control tests that write evidence, the model validation reports, and the testing workpapers. Those are what make this a GRC project and not just a trading app.

## Sources

- [Federal Reserve, SR 26-2: Revised Guidance on Model Risk Management](https://www.federalreserve.gov/supervisionreg/srletters/sr2602.htm)
- [Moody's, From SR 11-7 to SR 26-2](https://www.moodys.com/web/en/us/insights/banking/from-sr117-to-sr262-managing-model-risk-when-models-dont-stand-still.html)
- [MAS, supervisory expectations on responsible AI adoption (7 Oct 2026)](https://www.mas.gov.sg/news/media-releases/2026/mas-sets-out-supervisory-expectations-on-responsible-ai-adoption-by-financial-institutions)
- [Sidley, Regulation S-P compliance deadline for smaller entities](https://datamatters.sidley.com/2026/04/30/u-s-sec-regulation-s-p-compliance-deadline-approaching-for-smaller-entities/)
- [Hogan Lovells, final NYDFS Part 500 requirements effective 1 Nov 2025](https://www.hlc.com/en/publications/nydfs-final-set-of-cybersecurity-requirements-under-amended-part-500-take-effect-november-1-2025)
- [Alpaca, About Market Data API](https://docs.alpaca.markets/docs/about-market-data-api)
- [QVeris, free stock API comparison (verified 3 Aug 2026)](https://qveris.ai/guides/stock-api-free-comparison/data/free-stock-api-comparison-2026-08-03.json)
