# Vendor register

Pending vendor-owner review. No SOC report is attached. The compliance console names this file. It does not call these vendors.

| Vendor | Live call from this app | Note |
| --- | --- | --- |
| Yahoo Finance | Yes. Scheduled refresh, source `eod`. | [grc/vendors/yahoo.md](../grc/vendors/yahoo.md) |
| Alpha Vantage | Portfolio and immediate-trade marks, trending, and research can call it on a process-cache miss when a key is configured. Not the scheduler source. | [grc/vendors/alpha_vantage.md](../grc/vendors/alpha_vantage.md) |
| SEC ticker map and company facts | Research can fetch the CIK map and company facts and commit a fundamentals cache. Not the active symbol-universe source. | [grc/vendors/sec.md](../grc/vendors/sec.md) |
| Nasdaq Trader | Symbol-universe synchronization downloads `nasdaqlisted.txt` and `otherlisted.txt`. Not an execution-price source. | [Provider access review](PROVIDER_ACCESS_REVIEW.md) |
| Massive | No. A fixture parser exists. Empty key does not call out. No two-year backfill. | [grc/vendors/massive.md](../grc/vendors/massive.md) |
| Finnhub | No. A candle-fixture parser and an in-process call budget exist. No WebSocket. | Not a separate assessment file. |
| Twelve Data | No. A series-fixture parser can sit behind the fallback chain. | Not a separate assessment file. |
| FRED | No. | Named in the expansion plan only. |
| Bluesky | No. Account rows are a YAML file. Nothing is polled. | `grc/signals/accounts.yaml` |
| Alpaca | No. | [grc/vendors/alpaca.md](../grc/vendors/alpaca.md) |
| OpenSanctions / yente | No. `YENTE_URL` is empty. | [grc/vendors/opensanctions.md](../grc/vendors/opensanctions.md) |
| Hugging Face Hub | No, unless `forecast_kronos_enabled` is set. Downloads pinned Kronos model/tokenizer weights for local forecasting. | [grc/vendors/huggingface.md](../grc/vendors/huggingface.md) |

Provider permissions are distinct from API access and quota. Some request handlers call providers; cached overview and heatmap reads do not. The in-process `CallBudget` counts calls inside one job. It is not a shared rate limiter. [PROVIDER_ACCESS_REVIEW.md](PROVIDER_ACCESS_REVIEW.md) records the 2026-11-05 source review and the approvals still missing.

**Approval:** Pending vendor-owner review.
