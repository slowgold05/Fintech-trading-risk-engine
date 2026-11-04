# Yahoo Finance — draft assessment

**Status:** Pending vendor-owner review. No SOC report is attached.

**Used by:** Scheduled quote refresh and the end-of-day source named `eod`. User requests read the cache.

**Data shared:** Symbol names in outbound quote requests. No customer name, account id, or order is sent.

**Criticality:** High for reference prices. SM-PT-02 and SM-MD-01 depend on a fresh cache. A failed refresh leaves the last cached quote, which ages into `stale`.

**Concentration:** This is the only scheduled price source. Alpha Vantage is optional and is not the scheduler source.

**Exit:** Point the refresh client at another cached source and keep the same `market_quote_cache` columns. Open orders still need a usable quote inside the band.

**Approval:** Pending vendor-owner review.
