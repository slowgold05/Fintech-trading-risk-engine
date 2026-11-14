# Massive — not connected

**Status:** Pending vendor-owner review. This is a roadmap name. The application does not call Massive.

The product roadmap lists Massive as a backup for the previous trading day's bars. The scheduled refresh uses Yahoo Finance. No Massive key is configured. No customer data is shared because no request is sent.

On 2026-11-04 the working tree can parse a grouped-daily fixture in `app.services.market_providers`. An empty key raises before any request. No backfill ran, and no daily job calls Massive.

**Terms review, 2026-11-11 (public search only, not a signed-contract confirmation):** Massive's own Market Data Terms of Service (last updated 2025-08-28) grant "a nonexclusive, nontransferable, non-sublicensable, revocable, limited license." Some data is sourced from Nasdaq and incorporates the UTP Subscriber Agreement by reference; a CME subscriber addendum also applies to relevant data. Massive's own knowledge base states plainly: "any user who wishes to redistribute Massive.com's market data must sign up for one of our business products."

**Resolved by the user directly, 2026-11-11:** the user stated this project's actual intent and took explicit responsibility for the classification — it is not intended to redistribute data, is not itself a data source for anyone else, and only displays data and demonstrates what can be built with it. That is squarely display/demonstration use, not redistribution, which is the specific ambiguity flagged above. This is the user's own decision, recorded here, not a new independent legal finding.

**Exit:** Nothing to disconnect. A real key, its rate limit, and its cost are still an ordinary setup task before Massive is actually used, separate from the resolved redistribution question.

**Approval:** The redistribution/display classification above is resolved by the user.
