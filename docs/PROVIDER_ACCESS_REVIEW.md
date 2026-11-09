# Provider access review

Reviewed 2026-11-05 at application commit `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`. This records source checks and implementation gaps. It does not grant usage rights or record vendor-owner approval. No provider key, subscription, or written agreement was inspected, and no market-data endpoint was polled for this review.

## Actual application dependencies

| Provider | Source-backed code path | Current boundary |
| --- | --- | --- |
| Yahoo Finance | `app/services/eod_service.py`: five-day daily-chart request, latest complete bar; `market_cache_service.py`: scheduled quote/history writes | Four-worker batch fetch; dated cache; no public-display permission verified |
| Alpha Vantage | `price_service.py`, called by portfolio valuation, immediate trades, trending, and research | Requests may occur on process-cache misses; it is not research-only |
| SEC | `sec_service.py`: ticker-to-CIK map and company facts, used by market research | Configured User-Agent, caching, and fundamentals-cache writes; no shared SEC limiter found in this path |
| Nasdaq Trader | `nasdaq_universe_service.py`: `nasdaqlisted.txt` and `otherlisted.txt` | Active symbol directory source; not a quote feed |

The Alpha Vantage and SEC assessments previously understated or misidentified these dependencies. Their corrected assessments and [vendor register](vendors.md) now match the inspected callers.

## Primary-source checks

### Alpha Vantage

The [terms of service](https://www.alphavantage.co/terms_of_service/), section 2, describe personal, non-commercial use unless otherwise agreed in writing, with defined commercial-use categories. The document was retrieved directly. A free or premium API key does not, by itself, prove permission for this application's public display, redistribution, storage, or later research use.

Required evidence: the applicable plan/agreement and permitted use for the intended audience. Vendor-owner approval and the earlier exposed-key revocation artifact remain open. No permission was inferred and no vendor was contacted.

### Yahoo Finance

The search-indexed official [US terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) restrict automated collection without prior permission. Direct page retrieval returned HTTP 999, so the full current page was not independently fetched. No project-specific permission was located or verified in this review.

Required evidence: applicable collection, retention, and display permission or a reviewed replacement source. Endpoint reachability, delayed labels, and an educational/paper-trading description do not establish those permissions. This is an unresolved access review, not a legal determination about the project.

### SEC

The [developer guidance](https://www.sec.gov/about/developer-resources) and [EDGAR access instructions](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) were retrieved directly. They specify identified automated access, efficient retrieval, and at most ten requests per second across a user's machines.

The code sends `SEC_USER_AGENT` and caches data. Its configured default contains an example contact; this review did not inspect the deployed value. Caching is not a shared request limiter. Confirm a valid contact and aggregate request behavior before expanding concurrency or backfills. This review does not establish rights for every item embedded in third-party filings.

### Nasdaq Trader

The official [directory definitions](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs) document the two directory files used by the code. The [lookup page](https://nasdaqtrader.com/trader.aspx?id=symbollookup) contains product-specific notices; statements for one data product must not be treated as a blanket licence for every Nasdaq dataset.

Required evidence: confirm the notice applicable to these exact files and intended storage/display use. This review does not authorize quote feeds, corporate-action products, or additional Nasdaq data.

## Decisions and follow-up

- Provider source review is performed with the retrieval limits above. Usage entitlements and vendor-owner approval remain unverified.
- Do not expand hosted collection, historical backfills, redistribution, or paid subscriptions based on this document alone.
- P1-A can be implemented and tested locally against controlled cached fixtures. Its no-provider-on-read requirement removes a valuation dependency; it does not license the cached data or change immediate-trade execution.
- A future provider decision must specify universe, interval, adjustment convention, history/storage rights, display audience, provenance, quotas, and cost. Obtain the applicable agreement before enabling that data path.
- Runtime access policy was not changed in this task. Existing pending approvals remain pending.
