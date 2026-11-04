# Alpha Vantage — draft assessment

**Status:** Pending vendor-owner review. No SOC report is attached.

**Used by:** Optional research quotes when `ALPHA_VANTAGE_API_KEY` is set. The scheduler does not use this provider. User requests read the cache.

**Data shared:** Symbol names and the API key on the provider request. No customer name or order is sent. The key lives in an ignored environment file.

**Criticality:** Low for trading, because the price band uses the cache and the scheduler uses Yahoo. High for the secret itself. The earlier key exposure is recorded in `grc/incidents/alpha-vantage-key-exposure.md`. Provider revocation evidence is not attached.

**Concentration:** Research-only. Trading does not require this vendor.

**Exit:** Leave the key unset. Cached rows remain. No code change is required to stop new calls.

**Approval:** Pending vendor-owner review.
