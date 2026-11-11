# Current delivery sequence, Stage 1 — status, 2026-11-11

Roadmap: [Sentinel_Markets_2_0_Roadmap.md, Stage 1](../Sentinel_Markets_2_0_Roadmap.md#1-baseline-and-permissions).

## Step 3 (S&P 500 list + index benchmarks): done

[docs/sp500_constituents_2026-11-11.md](sp500_constituents_2026-11-11.md)
(source evidence) and
[P8B_SP500_CONSTITUENTS_VERIFICATION.md](P8B_SP500_CONSTITUENTS_VERIFICATION.md)
(the built, tested data files). 503 constituents, 4 named benchmarks,
dated and sourced.

## Step 4 (provider entitlement recording): recorded for all seven named providers

Every provider the roadmap names (Massive, Finnhub, LSE, Yahoo, Alpha
Vantage, SEC, Tauric) now has a dated, sourced entry:

- **Massive** — [grc/vendors/massive.md](../grc/vendors/massive.md),
  updated 2026-11-11: Massive's own terms require signing up for a
  business product to redistribute data; whether serving cached data to
  multiple registered private-app accounts counts as "redistribution" is
  not established by public search and needs a direct answer.
- **Finnhub** — [grc/vendors/finnhub.md](../grc/vendors/finnhub.md),
  2026-11-11: conflicting third-party sources on commercial-use terms;
  its own LSE-data product is personal-use licensed, same open question
  as LSE itself for a private multi-account backend.
- **LSE/LSEG** — [grc/vendors/lse.md](../grc/vendors/lse.md), updated
  2026-11-11 after confirming this is a private project: no self-serve
  API exists; third-party redistributors are personal-use licensed;
  whether that covers an automated private backend is still open.
- **Yahoo Finance, Alpha Vantage, SEC, Nasdaq Trader** — already recorded
  2026-11-05 in [docs/PROVIDER_ACCESS_REVIEW.md](PROVIDER_ACCESS_REVIEW.md),
  not reopened here; all remain "Pending vendor-owner review."
- **Tauric (`TradingAgents`)** — already recorded in
  [grc/vendors/tradingagents_data_vendors.md](../grc/vendors/tradingagents_data_vendors.md);
  confirmed 2026-11-11 this is the exact repository already vendored into
  this codebase, not a separate hosted-report service (see the roadmap's
  Stage 5 correction).

**Resolved by the user directly, 2026-11-11:** rather than chase each
provider's own redistribution/commercial-use terms further, the user
stated the actual intent plainly and took explicit responsibility for
it: this project is not intended to redistribute data, is not a data
source for anyone else, and only displays data and demonstrates what can
be built with it. That resolves the specific ambiguity this review kept
surfacing (whether "personal use"/"no redistribution" terms cover a
private app with a handful of registered accounts) — the user's own
stated use is squarely display/demonstration, not redistribution, and
the user owns that classification. This is not a new independent legal
finding by this review; it is the user's own decision, recorded here.
Each provider still needs its own entitlement/rate-limit answer before a
real key is used in production (quota and commercial-plan questions are
separate from the redistribution question just resolved), but the
specific "is this redistribution" blocker that this step kept flagging
across Massive, Finnhub, and LSE is closed.

## Step 1 (baseline: commit, hosted images, schema, browser journey, account reconciliation): partially done

Facts actually confirmed today, directly against the live AWS account
(not assumed from an older doc):

- **Hosted images are newer than the last written record.** `docs/RELEASE_2026-11-09.md`
  recorded `:fintechapp-preview.api.5` / `:fintechapp-preview.web.6`.
  The live deployment today runs `:fintechapp-preview.api.7` /
  `:fintechapp-preview.web.8` — confirmed via `aws lightsail
  get-container-services`. Something deployed a newer image between
  2026-11-09 and today that was never written up; this file is not that
  write-up, it only notes the digest drift exists.
- **The deployment reached `ACTIVE`/`RUNNING`.** `RELEASE_2026-11-09.md`
  recorded deployment 8 as `ACTIVATING`, not verified active. As of
  today, `aws lightsail get-container-services` reports `state: RUNNING`
  and `GET /api/health` returns `{"status":"ok"}`.
- **`SCHEDULED_JOBS_ENABLED` was `false`, now `true`.** Confirmed by
  direct inspection before changing it, changed with every other
  container setting preserved byte-for-byte, redeployed, and confirmed
  running — see [P8A_PROVIDER_ENTITLEMENT_REVIEW.md](P8A_PROVIDER_ENTITLEMENT_REVIEW.md)'s
  "Resolved, 2026-11-11" section for the full diagnosis and fix.
- **The scheduler lock mechanism (`scheduler_locks` table,
  `app/services/scheduler_lock.py`) is a real, working 24-hour mutex
  across container restarts, not a bug.** Confirmed by reading the
  lock-acquisition logic and by directly observing one successful cycle
  (`research=[]`, correctly empty since no job existed yet) followed by
  two further cycle attempts correctly skipped ("another process holds
  the scheduler") because the lock's `next_due` was already set 24 hours
  out. Two real test research jobs (`#3`, `#4`, created via a disposable
  test account on the host) are queued and will be picked up by the next
  real cycle (~18:03 EST, 2026-11-12) rather than forced early — the
  user's explicit choice, to avoid building a one-off privileged database
  runner (the hosted database is not publicly reachable, confirmed via
  `aws lightsail get-relational-databases`) just for this verification.

**Not done, still blocked, same disclosed boundary as every earlier
Phase 0 gate this session:** a real authenticated browser journey
against the host (no browser-automation tooling available in this
sandboxed environment), and hosted account reconciliation (would require
reading real account/ledger data, not attempted).

## Step 2 (baseline tasks not yet touched)

Not attempted in this pass: reconciling hosted account data against the
ledger. This remains open, same as the still-blocked gates recorded
earlier in this session's Phase 0 re-checks.

## What this means for Stage 1's exit gate

Not fully met. Step 3 and step 4 are done. Step 1 is partially done (host
state facts confirmed and one real defect fixed) but the browser-journey
and account-reconciliation sub-items remain open, same boundary as
before. Stage 2 (which depends only on step 3's data file, already done)
can reasonably start; Stage 1 as a whole should not be marked complete
while those two sub-items stay open.
