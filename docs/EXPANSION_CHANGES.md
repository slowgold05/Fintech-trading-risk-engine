# Expansion roadmap changes

## Hosted release addendum — 2026-11-04

The implemented components and reviewed audit fixes are now deployed in Lightsail deployment 7. Migrations through `f3a8c2d7e961` and application-role grants ran through a separate temporary private runner, with no migration credential in the web deployment. Existing row counts were preserved, all 14 accounts reconciled after smoke testing, and the runner was removed. The scheduler is enabled; its first cycle refreshed 180 quotes and stored 23 evidence payloads with verified export hashes. Live HTTP checks passed login, compliance reads, intent approval, paper cash replay, and order placement/replay/cancellation. Browser click-through remains unverified. See `docs/aws_deployment.md` for the release record.

The full expansion roadmap remains incomplete. The integration limits below still apply. Historical statements about an undeployed working tree describe the original build, not the current hosted release. All 134 backend tests passed with disposable PostgreSQL, all 9 frontend tests and lint/build passed, and all six application-release CI jobs passed.

## Original build record

2026-11-04. This is the working tree. It is not deployed. `aws login` was not run. Nothing was committed. No vendor, SEC, Bluesky, or other public API was called. No language model was called. Kronos weights were not downloaded. Pandas, NumPy, PyTorch, VADER, and FinBERT were not added.

The plan is `docs/Sentinel Markets — Expansion Roadmap.md`. Boxes are checked only where this tree has the behavior. The notes below are the limits.

## Phase 0

`docs/security/AUDIT-001.md` maps the checklist. `docs/SECURITY.md` is the reporting policy. The root product note stays `Security.md`, because a second root file with that name would replace it on this disk.

Gitleaks, `.gitignore`, `.env.example`, and the six-job workflow were already in the tree. This session did not rotate a GitHub token, did not scan git history again, and did not re-query branch protection. High findings that stay open are the hosted image lag, the lack of a secret manager, and the missing Alpha Vantage provider revocation artifact. Phase 0 is not closed.

## Phase 1

`app/services/market_quality.py` checks missing bars, stale dates, non-positive or inverted prices, close-to-close jumps over 50 percent, and a cross-source disagreement over 2 percent. `tests/test_expansion.py` feeds a corrupted batch, opens a finding, and shows `risk_inputs_allowed` is false for that symbol. An override requires an actor and a reason and returns a log dict. That log is not a database row. The scheduler does not call these checks on every load, and the order path does not call them. Those two checkboxes stay open.

`batch_checksum` and `lineage` are computed in memory. `price_history_daily` did not gain a checksum or fetch-time column. A risk number on an order does not yet point at that lineage dict. The local-store checkbox and the lineage checkbox stay open.

`app/services/market_providers.py` parses Massive grouped-daily, Finnhub candle, and Twelve Data fixtures. A fetch runs only when the caller passes `http_get` and a non-empty key. The default empty key raises `ProviderUnavailable`. `CallBudget` stops the 61st call when the limit is 60. It is not a distributed limiter. There is no WebSocket, no reconnect loop, and no two-year backfill. Yahoo stays the scheduler source. The Massive, Finnhub, and Yahoo/Twelve job checkboxes stay open.

`docs/vendors.md` is the register. The compliance page names that path. The page was not clicked in a browser.

## Phase 2

`app/services/forecast.py` is a historical-volatility forecaster. It uses the standard-library sample standard deviation of log returns. `walk_forward(sample_closes())` on 2026-11-04 produced 30 trials, 30 hits, and a hit rate of 1.0000, so the pass rule (at least 5 trials and a hit rate of at least 0.8) passed. That series is a 1 percent up-and-down fixture, not a market history. Hit rate is not precision or recall.

`simulate_paths` draws 200 seeded paths. On that same fixture the 10 percent drawdown probability was 0.0, the loss p50 was 0.3339, and the loss p95 was 3.9585. Those numbers were written by `python -m app.scripts.validate_forecast` into `grc/models/reports/SM-FC-01.md` and `grc/models/cards/SM-FC-01.md`. The inventory row was merged. Approval remains "Pending model owner review." There is no second baseline model. This forecaster is the naive historical-volatility model.

`advisory_signal` returns nothing unless validation passed and the monitor status is `enabled`. The monitor returns `disabled` when the mean absolute log error is above 0.20. `soft_limit_note` keeps the same hard limit and may add a note. Pre-trade order checks were not changed, and they do not read this signal. The Kronos function returns `enabled: false` even when a checkpoint path is set. This build does not load weights. The Kronos-checkpoint checkbox stays open.

## Phase 3

`trade_intents` stores a proposal. `propose_intent` rejects injection phrases, a malformed symbol, side, size, or confidence, and a notional above the $50,000 position cap. Rejected rows are stored. `technical_note`, `risk_note`, and `debate_note` are deterministic. They are not a local model and not a network call.

Approving an intent records `decided_by_user_id` and `decided_at`. The test approves one clean intent and counts zero orders. An auditor receives 403. An approved row with a null approver fails SM-AI-01, opens a finding, and shows up in the markdown workpaper.

The existing order checks for buying power, the price band, concentration, and the position cap were not modified. There is still no daily-loss rule. The intent path does not call those order checks. That pre-trade checkbox stays open. The product remains paper-only.

Signal helpers live in `app/services/signals.py`. A cashtag must match the universe. The bare word "IT" does not. Sentiment is a six-word lexicon. Credibility rank is regulator, then newswire, then company IR, then curated or analyst, then search. The manipulation label is exactly "unusual activity, needs review" and the result does not contain a handle. It does not itself open a finding, so that checkbox stays open.

`grc/signals/accounts.yaml` seeds the eight named accounts and three rejected handles. Every seed fails `review_account` because `approved_by` is blank. No DID was resolved over the network, and no recent-post check was made. The onboarding boxes stay open. There is no `signal_items` table. Registry history is git history, not a signed onboarding record.

The compliance page lists intents, findings, and the latest brief, and it names `docs/vendors.md`. An admin or compliance officer can approve a proposed intent from that page. Vitest covers the empty states. The page was not clicked in a browser.

## Phase 4

Five controls were added: SM-DQ-01, SM-FC-01, SM-AI-01, SM-SG-01, and SM-BR-01. Risks R-25 through R-29 point at them. R-08 and R-09 stay unmapped. No hollow control was added to chase a count of 30 to 40. `python -m app.scripts.export_controls` wrote 28 controls. The register has 29 risks.

The runner in `app/scripts/run_controls.py` now records those five after SM-AU-01. Empty populations are `no_sample`. An open finding fails SM-DQ-01 and SM-FC-01. An approved intent with no approver fails SM-AI-01. Injection text that is still proposed fails SM-SG-01. A stored brief with a number absent from its figures fails SM-BR-01. The scheduled cycle already calls `app_control_results`, so these checks run when `SCHEDULED_JOBS_ENABLED` is on. That flag stays off in Compose and on the hosted service. The cycle's step names were not changed.

The workpaper is markdown from `workpaper_markdown`. No PDF and no XLSX were produced. That checkbox stays open.

## Phase 5

`publish_brief` renders a fixed template, rejects a number that was not supplied, stores `risk_briefs`, and inserts `expansion_alerts` with `evidence_ref` `risk_brief:{id}`. The test uses limit utilisation 50000 against a hard limit of 50000 and checks that the breach alert points at that brief. A body containing 99999 fails verification and is not stored by `publish_brief`. `archive_brief` writes the same text to a file after the same check. `python -m app.scripts.publish_risk_brief` does that from a local JSON file. It does not open a database and does not send email, Slack, or Discord. There is no GitHub Actions schedule. The cron checkbox and the outbound-alert checkbox stay open.

The narrative is a template. No external model writes it.

## Database and grants

Migration `e7b2c5d9a174` revises `d5e9f2b8c047` and creates `trade_intents`, `findings`, `risk_briefs`, and `expansion_alerts`. Migration `f3a8c2d7e961` revises it and adds `detection_cursors` and `scheduler_locks`. `scheduler_locks.next_due` is part of that same unreleased revision. Neither migration is applied to the hosted database. The hosted database is still Alembic `c7e8f1a2b345`. Tests build the tables with `create_all`. `decided_by_user_id` is nullable so SM-AI-01 can see a bad approval.

`configure_postgres_role.py` grants insert and the limited updates for those tables. That script was not run against the hosted database. The app role only receives grants for objects that exist at grant time, so a later deploy with `RUN_DB_SETUP=true` has to run it after this migration. `MIGRATION_DATABASE_URL` stays out of the long-lived API service. `MFA_REQUIRED` stays false. `YENTE_URL` stays empty.

## Tests

`python -m pytest -q` from the repository root during the expansion build: 105 passed. A later audit run on 2026-11-04, with `AUDIT_DATABASE_URL` pointed at a disposable PostgreSQL, passed 116. A follow-on pass the same day, after scan deduplication and the scheduler due time, passed 127 on a new disposable database. That database was then removed. A later pass the same day kept the full detection identity and returned every qualifying AML pattern. `python -m pytest -q` without `AUDIT_DATABASE_URL` passed 126, and the five PostgreSQL race tests were skipped. Frontend `eslint` on the touched files, `tsc -b`, and `npm test` from `frontend`: 9 passed during the expansion build. The follow-on pass did not change a frontend file. The compliance page was not clicked in a browser.

## Still open

- Deploy, including migrations through `f3a8c2d7e961`.
- Provider evidence that the Alpha Vantage key was revoked, a secret manager, and an evidence copy outside the database.
- A persisted bar checksum, a logged override row, and an order-path block.
- Live Massive, Finnhub, Twelve Data, FRED, Bluesky, RSS, and SEC filing polls.
- Kronos weights, and any use of the forecast inside order limits.
- Signed signal onboarding, a `signal_items` table, and a buzz panel.
- PDF or XLSX workpapers, email or chat alerts, and a vendor cron.
- Policy, model, vendor, and asset-owner approval. Nothing in this change was marked approved.
