# London Stock Exchange (LSE/LSEG) — draft assessment, likely blocked as scoped

**Status:** Pending vendor-owner review, with a specific concern flagged below that may make the current delivery sequence's Stage 3 plan ("LSE as a whole-series fallback") infeasible without a real commercial contract. This is a roadmap name for Stage 1 ([Sentinel_Markets_2_0_Roadmap.md](../../Sentinel_Markets_2_0_Roadmap.md#1-baseline-and-permissions)). No LSE adapter exists anywhere in this repository today — this is a new vendor, not an existing fixture-only path like Massive or Finnhub.

**Used by:** Nothing yet. No code references LSE/LSEG anywhere in `app/`.

**Terms review, 2026-11-11 (public search only, not a signed-contract confirmation):**

- LSEG (London Stock Exchange Group) does not appear to offer a simple, self-serve developer API for historical daily OHLCV bars. Its own documented products are either enterprise data platforms (Refinitiv Data Platform — "a premium service" requiring "appropriate license") or file-delivery products (End of Day Summary, delivered via Managed File Transfer), aimed at licensed institutional customers, not a public app's backend.
- LSEG's own contact for pricing/licensing is `marketdata@lseg.com` — a sales conversation, not a self-service signup.
- Third-party redistributors (Finnhub, EODHD, Twelve Data) do offer LSE price history through their own APIs, but every one found in this search describes its own LSE license as **personal use** (one redistributor's own terms: "a limited, personal, non-transferable, non-exclusive licence"). None of these grant public/commercial redistribution rights for LSE data as part of a public-facing product.

**This is a real, specific risk, not a formality:** as currently scoped, "LSE as a whole-series fallback" for a public-facing paper-trading app most likely requires a direct, negotiated LSEG commercial license (through `marketdata@lseg.com`), not a third-party API key. Building an LSE adapter against a personal-use-licensed key and then displaying that data publicly would violate the license terms found in this search, pending the vendor-owner's own direct confirmation with LSEG. **Recommend re-scoping Stage 3 to drop LSE as a fallback, or securing a real LSEG commercial agreement, before building any LSE adapter code** — building the adapter first and discovering the licensing problem after is the wrong order for exactly the reason the current delivery sequence itself gives for sequencing entitlement checks before data-pipeline code (Stage 1 before Stage 3).

**Criticality:** N/A — nothing built, nothing live.

**Concentration:** N/A.

**Exit:** N/A — there is nothing to disconnect.

**Approval:** Pending vendor-owner review, with the specific personal-use-license concern above needing a direct answer from LSEG (not a third-party redistributor's key) before any LSE adapter is built.
