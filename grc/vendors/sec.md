# SEC company tickers and fundamentals — draft assessment

**Status:** Pending vendor-owner review. No SOC report is attached.

**Used by:** Ticker-to-CIK lookup from `company_tickers.json` and XBRL company facts from `data.sec.gov`, through `app/services/sec_service.py`. Research requests can fetch and commit a fundamentals-cache row. The active symbol-universe sync comes from Nasdaq Trader, not this SEC lookup.

**Data shared:** The user-agent string on the request. No customer name, account, or order is sent.

**Criticality:** Moderate for company research and CIK enrichment. This is not the quote source or the order execution authority.

**Concentration:** The current SEC fundamentals path depends on the ticker map and company-facts endpoint. A failed request does not establish that cached data is current.

**Exit:** Keep dated cached fundamentals and visibly mark unavailable research; changing this source does not replace the Nasdaq symbol directory.

**Access review, 2026-11-05:** SEC's [developer guidance](https://www.sec.gov/about/developer-resources) and [EDGAR access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) require efficient access, an identified User-Agent, and an aggregate maximum of ten requests per second. The code supplies configured headers and caches results, but no shared SEC request limiter was found in this path. A valid deployed contact and aggregate rate behavior remain unverified. See [the provider review](../../docs/PROVIDER_ACCESS_REVIEW.md).

**Approval:** Pending vendor-owner review.
