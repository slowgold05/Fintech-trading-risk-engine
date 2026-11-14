# London Stock Exchange (LSE/LSEG) — draft assessment

**Status:** Pending vendor-owner review. This is a roadmap name for Stage 1 ([Sentinel_Markets_2_0_Roadmap.md](../../Sentinel_Markets_2_0_Roadmap.md#1-baseline-and-permissions)). No LSE adapter exists anywhere in this repository today — this is a new vendor, not an existing fixture-only path like Massive or Finnhub.

**Used by:** Nothing yet. No code references LSE/LSEG anywhere in `app/`.

**Update, 2026-11-11:** this project is confirmed private, not a public résumé-style deployment. The original version of this file assessed the risk assuming public display/redistribution, where a personal-use-only license would be a clear violation. That specific framing no longer applies as written — but this does **not** mean personal-use terms are automatically fine for this use case either. The actual question for a private project is narrower and still unanswered: do the personal-use terms found below cover *this* use (a privately-hosted app, not public, but still a deployed service pulling data programmatically on a schedule, not a single individual manually checking quotes)? That distinction matters to some providers' terms and has not been checked.

**Terms review, 2026-11-11 (public search only, not a signed-contract confirmation):**

- LSEG (London Stock Exchange Group) does not appear to offer a simple, self-serve developer API for historical daily OHLCV bars. Its own documented products are either enterprise data platforms (Refinitiv Data Platform — "a premium service" requiring "appropriate license") or file-delivery products (End of Day Summary, delivered via Managed File Transfer), aimed at licensed institutional customers.
- LSEG's own contact for pricing/licensing is `marketdata@lseg.com` — a sales conversation, not a self-service signup.
- Third-party redistributors (Finnhub, EODHD, Twelve Data) do offer LSE price history through their own APIs, and every one found in this search describes its own LSE license as **personal use** (one redistributor's own terms: "a limited, personal, non-transferable, non-exclusive licence"). What "personal use" means for an automated private backend (vs. a human looking at a UI) was not established by this search — that is exactly the open question for a private project, not a solved one.

**Resolved by the user directly, 2026-11-11:** the user stated this project's actual intent and took explicit responsibility for the classification — it is not intended to redistribute data, is not itself a data source for anyone else, and only displays data and demonstrates what can be built with it. That is squarely display/demonstration use, not redistribution, which is the specific ambiguity this file kept flagging. This is the user's own decision, recorded here, not a new independent legal finding.

**Criticality:** N/A — nothing built, nothing live.

**Concentration:** N/A.

**Exit:** N/A — there is nothing to disconnect.

**Approval:** The redistribution/display classification above is resolved by the user. A real LSE adapter would still need its own ordinary provider setup (an actual account/key, rate limits, cost) before being built — that is a separate, mechanical task, not a licensing blocker.
