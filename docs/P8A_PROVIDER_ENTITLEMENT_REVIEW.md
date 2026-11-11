# Current delivery sequence, Stage 1 — provider entitlement review

Roadmap: [Sentinel_Markets_2_0_Roadmap.md, Stage 1](../Sentinel_Markets_2_0_Roadmap.md#1-baseline-and-permissions).
This records Stage 1's step 4 (provider entitlement recording) for
Massive, Finnhub, LSE, and Tauric. **This is research and documentation
only — no code changed, no provider connected, no key configured.**

## What this review found

- **Massive**: already tracked in [grc/vendors/massive.md](../grc/vendors/massive.md) as "Pending vendor-owner review," fixture-only. A public search for current pricing/rate-limit/redistribution terms turned up only conflicting third-party sources, no authoritative answer — [grc/vendors/massive.md](../grc/vendors/massive.md) is unchanged; this review does not resolve its pending status.
- **Finnhub**: new assessment at [grc/vendors/finnhub.md](../grc/vendors/finnhub.md). Public sources disagree on commercial-use permission for the free tier, and Finnhub's own LSE-data product is described as personal-use-licensed by third parties.
- **LSE/LSEG**: new assessment at [grc/vendors/lse.md](../grc/vendors/lse.md), with a specific, actionable finding: LSEG does not appear to offer a simple self-serve API for historical daily OHLCV — its own products are enterprise/file-delivery, contacted via `marketdata@lseg.com`. Third-party redistributors' own LSE licenses are personal-use only. **As scoped, Stage 3's "LSE as a whole-series fallback" likely needs a real negotiated LSEG contract, not just an API key.**

## A finding that needs the user's clarification before Stage 5 proceeds

The current delivery sequence's Stage 5 describes "Tauric's shared daily report" — a hosted report published by Tauric Research that this app would read and cache, distinct from self-running the `TradingAgents` package. **A public search did not find evidence that this service exists.** What it did find:

- `TauricResearch` (the organization behind `TradingAgents` and `Kronos`, both already integrated in this codebase) does not appear to operate a public hosted daily-report API or shared-report service, as far as this search could establish.
- The open-source project named `daily_stock_analysis` — already referenced in this roadmap's own "References and official project references" section — is attributed to a **different** author, `ZhuLinsen`, not TauricResearch, per the GitHub repository found in search. It is described as a **self-hosted** tool (fork the repo, configure your own LLM key, run it yourself, optionally deploy it to your own Railway instance) — not a shared service you read reports *from*.

**This looks like a possible conflation of two different projects** (TauricResearch's `TradingAgents`/`Kronos` vs. the unrelated `ZhuLinsen/daily_stock_analysis`), or it refers to something this search genuinely could not find (a private arrangement, a different product name, or a very recent offering not yet indexed). Rather than build Stage 5 against a premise that may not correspond to anything real, **this needs the user to clarify**: is there a specific, real Tauric-operated shared-report endpoint or product in mind, with a name or URL that can be checked directly? If not, Stage 5 likely needs to be re-scoped to either (a) continue using only the existing self-run `TradingAgents` path (already built, already governed, already labeled optional), or (b) a different, real shared-report source if one exists under a different name.

## What this does not do

This review does not obtain, sign, or confirm any actual vendor agreement — that requires the user (or whoever owns vendor relationships for this project) to check each provider's own current terms page directly and record the dated, sourced answer, per Stage 1's own exit gate. Public search results are not a substitute for that and are flagged as such throughout, including in the two new vendor files above.
