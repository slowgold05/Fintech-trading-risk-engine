# Massive — not connected

**Status:** Pending vendor-owner review. This is a roadmap name. The application does not call Massive.

The product roadmap lists Massive as a backup for the previous trading day's bars. The scheduled refresh uses Yahoo Finance. No Massive key is configured. No customer data is shared because no request is sent.

On 2026-11-04 the working tree can parse a grouped-daily fixture in `app.services.market_providers`. An empty key raises before any request. No backfill ran, and no daily job calls Massive.

**Exit:** Nothing to disconnect. A future integration would need its own assessment before a key is stored.

**Approval:** Pending vendor-owner review.
