# Alpha Vantage — draft assessment

**Status:** Pending vendor-owner review. No SOC report is attached.

**Used by:** Portfolio valuation (`GET /portfolio/`), immediate trades (`POST /trades/`), trending, and company research when `ALPHA_VANTAGE_API_KEY` is set. These request paths can call the provider when their process caches miss. The scheduler uses Yahoo instead. The order-book matching path is separate.

**Data shared:** Symbol names and the API key on the provider request. No customer name or order is sent. The key lives in an ignored environment file.

**Criticality:** High for the current portfolio and immediate-trade paths on a cold cache; they can fail when the key or provider is unavailable. Order-book reference checks use the database cache. The earlier key exposure is recorded in `grc/incidents/alpha-vantage-key-exposure.md`. Provider revocation evidence is not attached.

**Concentration:** The current portfolio and immediate-trade marks depend on this provider. P1-A plans to remove provider calls from portfolio reads; it has not been implemented. That task does not change immediate-trade execution prices.

**Exit:** Removing the key stops new authenticated provider calls but can break cold-cache portfolio reads and immediate trades. A replacement must be reviewed with those callers; it is not a transparent research-only switch.

**Terms review, 2026-11-05:** The [provider terms](https://www.alphavantage.co/terms_of_service/) grant personal, non-commercial use unless otherwise agreed in writing and define commercial-use cases. Public display and redistribution rights for this application's actual use are not established by possession of a key. Record the applicable agreement and obtain vendor-owner approval before expanding usage. See [the provider review](../../docs/PROVIDER_ACCESS_REVIEW.md).

**Approval:** Pending vendor-owner review.
