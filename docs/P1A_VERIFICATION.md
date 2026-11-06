# P1-A cached portfolio valuation review

Reviewed locally on 2026-11-05 against base `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`. The implementation and review corrections are uncommitted. This is not deployment evidence or a Phase 1 completion claim.

## Implementation and review

Grok's 14 P1-A files were copied from its separate checkout to `E:\fintechapp` after confirming identical HEAD, unchanged target versions of tracked implementation files, and matching copied-file hashes. Subsequent corrections and checks ran in `E:\fintechapp`.

`GET /portfolio/` reads cached quotes without contacting providers. Missing, invalid, stale, or unsupported marks retain the holding with nullable valuation fields. Incomplete books have null dependent totals; cash, reservations, cost basis and realized P&L remain known. Quote observation and fetch times are distinct from the snapshot read timestamp. Existing JSON numbers remain floats after Decimal arithmetic and quantization.

Codex found and reproduced a SQLite consistency defect in the initial implementation. A writer changed cash from 1000 to 500 and inserted a 100 reservation between the joined valuation query and the reservation query. The original code returned cash 1000 and buying power 900. Neither valid whole state, (1000, 1000) or (500, 400), has that result. SQLite now explicitly starts a read transaction when the driver has not started one. PostgreSQL uses a read-only repeatable-read transaction.

The concurrency regression now changes reservations and checks buying power as well as cash, holdings, marks and realized P&L. A separate PostgreSQL regression commits the cash/reservation change between the two reads and verifies both the in-flight and following responses. Nonzero holdings remain in the valuation query; the current schema still prohibits negative quantities. Incomplete books suppress inferred position-risk labels for every position, including positions with available marks. Available marks and actual numeric zero P&L remain visible.

## Verification

- Focused backend: `python -m pytest -q tests/test_portfolio_valuation.py tests/test_trades.py tests/test_orders.py tests/test_ledger.py` — 36 passed.
- Complete backend: `python -m pytest -q --tb=short --disable-warnings`, with `AUDIT_DATABASE_URL` pointing only to a newly created `p1a_audit_*` database on the existing isolated `p0b-pg17-proofs` container, loopback port 54329 — 144 passed, 1 skipped, 563 warnings. Python 3.14 did not have Selenium, so the browser module was skipped in this run. All seven PostgreSQL proofs ran, including the new snapshot proof.
- Frontend: `npm.cmd test` — 9 files, 24 tests passed. `npm.cmd run lint` and `npm.cmd run build` passed. Build retained the existing chunk-size warning; bundle `index-D5Yhqwek.js`.
- Separate live-browser check: Selenium 4.52.0 in the existing Python 3.11 environment, Chrome against web `http://127.0.0.1:4173` and API `http://127.0.0.1:8000`, using only `p0b_browser` on isolated loopback port 54331 at revision `f3a8c2d7e961`. `test_cached_portfolio_incomplete_and_complete` passed. CSS viewport 1264 by 649. A new designated test identity and synthetic holdings were used. The page showed incomplete totals, retained known cash and available marks, suppressed misleading chart/risk/return displays, and recovered to account value 100200 and actual zero P&L after the missing cached quote was inserted. API and preview processes stopped afterward.
- The existing `test_local_designated_trader_journey` also passed separately in 22.09 seconds against this build: public entry, login, resting limit order, idempotent replay, reservation and cancellation, trader compliance denial, missing session, and expired access/refresh handling. Each browser run used a fresh designated test identity.
- Browser isolation was then tightened: `tests/browser/isolated_api.py` blocks all HTTP through the provider library (`requests`) inside the API process, and the Alpha Vantage key is explicitly empty. Both journeys passed again under that guard (7.72 seconds for cached valuation, 22.14 seconds for the existing journey). A unit regression verifies the provider guard without making a network request. Earlier browser runs did not independently establish outbound-provider isolation; the guarded reruns are the evidence for it.

An initial PostgreSQL rerun reused the old proof database and hit two exact rule-count assertions because earlier runs had left extra rule activations. The fresh isolated database run above passed. This is why reused proof data is not treated as a clean test fixture.

## Boundaries

The cached portfolio endpoint and guarded browser reruns do not request provider data. Earlier browser runs did not independently establish outbound-provider isolation. No migration, hosted mutation, deployment, source commit, or permission-setting bypass was performed for P1-A. Execution, order matching, cash posting, authentication and role controls were not edited. The application-role password was refreshed only inside the disposable browser PostgreSQL instance. Starting Docker Desktop also resumed its configured containers; no development rows or schema were edited.

The broader fabricated chart and daily-P&L labeling behavior for complete books was outside P1-A; the subsequent [signed-in UI correction](UI_DATA_TRUTHFULNESS.md) now addresses it locally. Backend and compatible clients must ship together because nullability changes the API contract. Provider entitlements and hosted/local divergence remain open release gates.
