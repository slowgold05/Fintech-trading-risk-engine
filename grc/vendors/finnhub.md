# Finnhub — draft assessment

**Status:** Pending vendor-owner review. No SOC report is attached. This is a roadmap name for the current delivery sequence's Stage 1 ([Sentinel_Markets_2_0_Roadmap.md](../../Sentinel_Markets_2_0_Roadmap.md#1-baseline-and-permissions)). The application does not call Finnhub for live data today.

**Used by:** `app/services/market_providers.py`'s `parse_finnhub_candles`/`fetch_finnhub_candles` exist as a candle-fixture parser and an in-process call budget. `fetch_finnhub_candles` raises immediately when `finnhub_api_key` (`app/core/config.py`) is empty — the default, unconfigured state. No WebSocket connection exists. No quote cache path calls Finnhub today.

**Data shared:** Would be a symbol name and the API key on any future live request. No customer data. No request is sent today.

**Terms review, 2026-11-11 (public search only, not an authoritative check):** Public, third-party sources (not Finnhub's own terms page, which was not directly confirmed in this pass) most commonly report a free-tier rate limit around 60 calls/minute. Sources **disagree** on commercial-use permission: one source says the free tier restricts commercial use; another says commercial use is Enterprise-only through sales; a third claims both commercial and non-commercial use are allowed "as long as users adhere to their terms and conditions." No source confirmed explicit redistribution rights on the free tier — one summary places redistribution under an Enterprise plan, but that summary is itself a third-party page, not Finnhub's own terms.

**LSE data specifically:** Finnhub's own LSE-data product page (found via search, not independently re-verified against Finnhub's full terms) is described by third-party sources as licensed for **Personal Use**. See [grc/vendors/lse.md](lse.md)'s 2026-11-11 resolution below.

**Resolved by the user directly, 2026-11-11:** the user stated this project's actual intent and took explicit responsibility for the classification — it is not intended to redistribute data, is not itself a data source for anyone else, and only displays data and demonstrates what can be built with it. That is squarely display/demonstration use, not redistribution, which is the specific ambiguity this file kept flagging (commercial-use/redistribution terms). This is the user's own decision, recorded here, not a new independent legal finding.

**Criticality:** None today — no live call path exists. Would become material only if/when Stage 3's data pipeline is built against it.

**Concentration:** N/A today.

**Exit:** Nothing to disconnect; no key is configured, no call path is live.

**Approval:** The redistribution/display classification above is resolved by the user. A real key, its rate limit, and its cost are still an ordinary setup task before Finnhub is actually used, separate from that resolved question.
