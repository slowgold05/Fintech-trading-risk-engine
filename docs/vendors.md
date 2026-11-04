# Vendor register

Pending vendor-owner review. No SOC report is attached. The compliance console names this file. It does not call these vendors.

| Vendor | Live call from this app | Note |
| --- | --- | --- |
| Yahoo Finance | Yes. Scheduled refresh, source `eod`. | [grc/vendors/yahoo.md](../grc/vendors/yahoo.md) |
| Alpha Vantage | Optional. Not the scheduler source. | [grc/vendors/alpha_vantage.md](../grc/vendors/alpha_vantage.md) |
| SEC company tickers | Yes, for the ticker file. | [grc/vendors/sec.md](../grc/vendors/sec.md) |
| Massive | No. A fixture parser exists. Empty key does not call out. No two-year backfill. | [grc/vendors/massive.md](../grc/vendors/massive.md) |
| Finnhub | No. A candle-fixture parser and an in-process call budget exist. No WebSocket. | Not a separate assessment file. |
| Twelve Data | No. A series-fixture parser can sit behind the fallback chain. | Not a separate assessment file. |
| FRED | No. | Named in the expansion plan only. |
| Bluesky | No. Account rows are a YAML file. Nothing is polled. | `grc/signals/accounts.yaml` |
| Alpaca | No. | [grc/vendors/alpaca.md](../grc/vendors/alpaca.md) |
| OpenSanctions / yente | No. `YENTE_URL` is empty. | [grc/vendors/opensanctions.md](../grc/vendors/opensanctions.md) |

Free-tier terms are a control. Pages read the database. They do not call a vendor. The in-process `CallBudget` counts calls inside one job. It is not a shared rate limiter.

**Approval:** Pending vendor-owner review.
