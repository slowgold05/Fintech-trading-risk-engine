# P2 overview verification

Recorded 2026-11-06. This note covers the recent-orders dashboard and the separation of portfolio snapshot read time from quote observation time. The unit is implemented locally. Acceptance is pending browser proof. Full P2 remains open. No commit, push, hosted mutation, or deployment is part of this record. Preparation is on review branch `codex/v2-cached-data-dashboard-20261106`, which is not yet committed or pushed.

Source and worker changes are by Grok. Codex reviewed them and ran the local checks below.

## Recent orders

`RecentOrdersDashboard` is read-only. It calls the existing owner-scoped `GET /orders/`. That route's default is the newest 50 orders. The dashboard shows the newest 5.

Each row shows status, quantity, remaining, and limit. A null market price renders as Market. A positive price keeps six decimal places, so `0.000001` is retained.

Loading, error with retry, empty, and cached failure are handled. Account figures from an independent successful read stay visible when the orders read fails.

The existing orders API, matching, reservations, cash, ledger, and authentication are unchanged. This unit adds no order mutation and no new API.

## Valuation timestamps

Portfolio valuation read time uses the returned `snapshot_read_at`. Per position, Quote observed uses `quote_at`. The displayed observation time is neither `fetched_at` nor the request clock.

Timestamps render as UTC year, date, and time. A missing, naive, or invalid value renders as Unavailable.

No history backfill, provider writer, or performance curve was added.

## Checks that ran

Codex, on the local tree:

- Vitest: 11 files, 52 tests passed.
- Lint passed. Production build passed. Bundle: `/assets/index-DfNNFfbT.js`, 495.87 kB.
- Formatter: 6 focused tests passed, including an explicit offset and a finite guard for an ISO value with an invalid month.
- Existing browser-isolation unit: 1 passed. That result is the isolation unit. It is separate from this slice's Selenium journey.
- Impeccable source detector returned `[]` for the three new surfaces.

New browser assertions for resting P0 border cases (open, canceled, remaining, and limit) and for UTC timestamps are implemented.

Initial browser failures were harness defects and were corrected: skip-link keyboard focus after the new link changed the tab count, and the header text `Side/type` versus `Side / type`.

Local Selenium helper execution is blocked by Windows Application Control (`WinError 4551`). This note does not claim that the current unit's browser journey passed.

No security control was changed. The prior backend result of 190 passed and 1 skipped remains historical. That suite was not rerun for this frontend unit.

## CI browser job, pending review and run

Headless Linux CI browser job and harness portability are implemented. Review and a remote run are still pending.

- Isolated PostgreSQL 17, database `p0b_browser`, loopback port 54331.
- Migrations and grants applied in that job.
- A new designated UUID email per test.
- The job uses its own POSIX process groups. Windows cleanup is unchanged.
- Provider HTTP is blocked. The hosted test is excluded.

CI bootstrap settings and import corrections are under review. Remote CI has not run.

## Still open

Finish CI and source verification, then run remote headless browser acceptance on `codex/v2-cached-data-dashboard-20261106`. Until that proof exists, this overview unit is local implementation only.

Full P2 stays open. P1-C provider ingestion and the exchange calendar stay gated. Do not start an ingestion writer. Do not mark Phase 0 or Phase 1 complete.
