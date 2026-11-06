# P2 overview verification

Recorded 2026-11-06. Recent orders, and portfolio snapshot read time separated from quote observation time, on review branch `codex/v2-cached-data-dashboard-20261106`. Draft PR 16: https://github.com/slowgold05/Fintech-trading-risk-engine/pull/16. Main is unchanged.

Source and worker changes are by Grok. Codex reviewed them.

## Recent orders

`RecentOrdersDashboard` is read-only. It calls the existing owner-scoped `GET /orders/`. That route's default is the newest 50 orders. The dashboard shows the newest 5.

Each row shows status, quantity, remaining, and limit. A null market price renders as Market. A positive price keeps six decimal places, so `0.000001` is retained.

Loading, error with retry, empty, and cached failure are handled. Account figures from an independent successful read stay visible when the orders read fails.

The existing orders API, matching, reservations, cash, ledger, and authentication are unchanged. This unit adds no order mutation and no new API.

## Valuation timestamps

Portfolio valuation read time uses the returned `snapshot_read_at`. Per position, Quote observed uses `quote_at`. The displayed observation time is neither `fetched_at` nor the request clock.

Timestamps render as UTC year, date, and time. A missing, naive, or invalid value renders as Unavailable.

No history backfill, provider writer, or performance curve was added.

## Remote CI

`52868ca5eb11cf8a4f2553455644c418c7e8f22e`, GitHub Actions run 42181947104: all 7 jobs succeeded. Prior `78abee8`, run 42180986655: all 7 jobs succeeded.

- Backend: 190 passed, 1 skipped. The backend job does not install Selenium. Browser coverage is the dedicated browser job.
- Frontend: 52 tests, lint, and build passed. Bundle from the 528 source: `index-BtUUj0-8.js`, 495.99 kB.
- Browser: 4 passed, 1 deselected (hosted excluded). Isolated fresh PostgreSQL 17, database `p0b_browser`, loopback port 54331. Migrations and grants applied. Provider HTTP blocked. A synthetic P0-B symbol and a fresh reference quote of 100 are seeded. The order is posted through the UI.

Codex downloaded the CI PNGs. At 390px the micro tile Stale is fully visible, and the populated orders table scrolls horizontally inside its container. Public compact, standard, and expanded Selenium text and status at 1280 and 390 fit with no overflow.

The heatmap instant-scroll wait and the mobile-table end details passed on `7dbddce5646b7bafb358ee4c7078196e10bba720`, run 42184498741. See [P2_RISK_VERIFICATION.md](P2_RISK_VERIFICATION.md).
