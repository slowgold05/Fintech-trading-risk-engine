# P3-B chart-to-ticket — verification

Codex reviewed the chart-to-ticket code and all seven captures and accepted code `464b8fe4a5a77d9aa6f1c4d27c5f43bd30bda008` on `codex/v2-chart-ticket-20261107`. Draft [PR 22](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/22) is stacked on PR 21. [CI 42356350884](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42356350884) is the accepted code run: all 7 jobs succeeded. No formal GitHub approval is claimed. The pull request stays a draft until documentation-head CI finishes. This note does not record that later head or any readiness result. Full P3-B stays open, and no phase box is checked. The earlier lifecycle UI remains historical in [P3B_LIFECYCLE_UI_VERIFICATION.md](P3B_LIFECYCLE_UI_VERIFICATION.md).

## Accepted code CI

Backend Python 3.12, fresh isolated PostgreSQL 17.11: 263 passed, 5 optional browser modules skipped, 864 warnings, 85.73s. Frontend: 227 passed, 21 files; lint and build passed. Headless Linux browser: 8 passed, 1 hosted case deselected, 109 warnings, 103.10s. Static analysis, security, dependency, and secrets jobs passed.

Local checks recorded with that code: frontend 227 tests in 21 files with lint and build passing, one isolation test passing with 16 warnings, collection of the new browser module only (1 test collected), and a plain Python AST check was valid and the six embedded JavaScript functions compiled. No local PostgreSQL run and no native browser run are claimed. Windows Application Control error WinError 4551 was not bypassed; no native Windows browser was launched. The existing frontend bundle warning stays about 544.98 kB. Dependencies are unchanged.

An earlier run, [CI 42355993586](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42355993586), failed in the browser test’s own SQL before the browser started. That SQL selected `orders.symbol`. The schema stores the symbol on `assets`, and the order row joins to it. `464b8fe` corrects the two queries. An isolated in-memory `EXPLAIN` check followed, and the PostgreSQL browser job in CI 42356350884 then passed. That earlier failure was bad test SQL, not an application runtime bug.

## Browser evidence

`tests/browser/test_p3b_chart_ticket.py` uses the real service, the designated disposable account, and the guarded disposable database. The fixture seeds symbol `P3HANDOFF` with a raw daily close of 105, a quote reference of 100, and a split-adjusted close of 52.5. The browser stays on the raw series. This note does not claim that the split series was opened.

The public chart shows partial coverage as not verified and collection as disabled. Chart and trade-link shots are separate because the facts rows sit between them. Codex reviewed `chart-desktop`, `chart-desktop-link`, `chart-mobile`, `chart-mobile-link`, `ticket-desktop`, `ticket-mobile`, and `order-detail` from `.local-tools/ci-browser-42356350884/p3b-chart-ticket`.

The journey is public chart, then the trade link only. The link query is `symbol=P3HANDOFF` and nothing else, including after an unsent symbol edit and after restoring the accepted symbol. Password sign-in on the real login form returns to `/trades?symbol=P3HANDOFF`. The ticket shows that symbol as its value. Quantity and limit are empty. The visible `100` and `150.00` hints are placeholders, not filled values. The blank ticket does not preview or post, including after the mobile capture and the return to desktop. The six owner activity counts are unchanged across that read, sign-in, and the later preview.

The explicit preview is buy, limit, quantity 1, limit 100. The captured body is only symbol, side, order type, quantity, and limit price. It does not carry the historical close of 105 or the split close of 52.5. Preview writes no order activity and does not change cash.

Confirm is a real `POST`. The book then holds one open buy, quantity 1, remaining 1, limit 100, with no fills. Detail shows original `1.000000`, filled `0.000000`, remaining `1.000000`, status open, limit `100.000000 USD`, and the UTC timestamps on that view. Confirm adds one order and one idempotency record. Trades, holdings, and lots stay unchanged. Dashboard cash stays the same and buying power is cash minus 100. Cancel from the detail UI restores buying power to cash. Root and main fit at desktop and at 390×844.

## Source and boundaries

The product change is three frontend files. Daily history shows the trade link only for an accepted, nonempty, current symbol whose loaded history matches, and hides it while a fetch or error is showing. The order ticket seeds one canonical `symbol` query parameter on first mount and ignores later query changes; an edited ticket, a preview, a pending submit, and the unknown-order retry key stay as they were. Login keeps an unknown-state-safe internal return path, and the password, MFA, and already-signed-in cases covered by tests still preserve that return. There is no key remount, no historical price copied into the ticket, and no automatic submit.

This slice changes no source backend, migration, grant, dependency, market-data provider, or authentication policy. It does not fetch from a provider, write provider data, or change order execution. Existing migration and grant proofs stay inside isolated CI only. No hosted or development database mutation. No merge, deploy, or AWS change.

The mounted-only unknown-order retry still drops its intent on reload or unmount. That remains a P7 release gate and is not solved here. Next is the persistent watchlist backend: ownership, create, read, update, delete, sort, caps, and locks, with the migration, grants, and proofs that unit needs. The watchlist UI follows that backend. This note does not implement either part. P1 provider, calendar, and ingestion stay open. P3-A indicator warm-up stays open. P4 and later, and the core release gate, stay open.
