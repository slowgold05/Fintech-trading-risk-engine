# Finnhub — draft assessment

**Status:** Pending vendor-owner review. No SOC report is attached. This is a roadmap name for the current delivery sequence's Stage 1 ([Sentinel_Markets_2_0_Roadmap.md](../../Sentinel_Markets_2_0_Roadmap.md#1-baseline-and-permissions)). The application does not call Finnhub for live data today.

**Used by:** `app/services/market_providers.py`'s `parse_finnhub_candles`/`fetch_finnhub_candles` exist as a candle-fixture parser and an in-process call budget. `fetch_finnhub_candles` raises immediately when `finnhub_api_key` (`app/core/config.py`) is empty — the default, unconfigured state. No WebSocket connection exists. No quote cache path calls Finnhub today.

**Data shared:** Would be a symbol name and the API key on any future live request. No customer data. No request is sent today.

**Terms review, 2026-11-11 (public search only, not an authoritative check):** Public, third-party sources (not Finnhub's own terms page, which was not directly confirmed in this pass) most commonly report a free-tier rate limit around 60 calls/minute. Sources **disagree** on commercial-use permission: one source says the free tier restricts commercial use; another says commercial use is Enterprise-only through sales; a third claims both commercial and non-commercial use are allowed "as long as users adhere to their terms and conditions." No source confirmed explicit redistribution rights on the free tier — one summary places redistribution under an Enterprise plan, but that summary is itself a third-party page, not Finnhub's own terms.

**LSE data specifically:** Finnhub's own LSE-data product page (found via search, not independently re-verified against Finnhub's full terms) is described by third-party sources as licensed for **Personal Use**, not commercial/public redistribution. If Finnhub is ever used as an LSE fallback path (as the current delivery sequence's Stage 3 proposes), this personal-use restriction is a real blocker for public display, not a formality — do not treat a Finnhub key as satisfying LSE's own public-display permission.

**Criticality:** None today — no live call path exists. Would become material only if/when Stage 3's data pipeline is built against it.

**Concentration:** N/A today.

**Exit:** Nothing to disconnect; no key is configured, no call path is live.

**Approval:** Pending vendor-owner review. Per Stage 1's exit gate in the current delivery sequence: an unconfirmed or ambiguous entitlement answer (which is what this search produced) means Finnhub data stays out of any public-facing surface until the vendor-owner reviews Finnhub's actual current terms page directly and records a dated, sourced answer — not a search summary like this one.
