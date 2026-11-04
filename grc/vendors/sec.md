# SEC company tickers — draft assessment

**Status:** Pending vendor-owner review. No SOC report is attached.

**Used by:** Symbol-universe refresh from the SEC `company_tickers.json` file, with the configured `SEC_USER_AGENT`.

**Data shared:** The user-agent string on the request. No customer name, account, or order is sent.

**Criticality:** Moderate for the symbol directory. Trading of a symbol still requires a cached quote and an active `market_symbols` row.

**Concentration:** This is the public universe source in the working tree. A failed refresh leaves the last synced symbols.

**Exit:** Keep the last `market_symbols` snapshot and stop the sync. New listings would not appear until another source is added.

**Approval:** Pending vendor-owner review.
