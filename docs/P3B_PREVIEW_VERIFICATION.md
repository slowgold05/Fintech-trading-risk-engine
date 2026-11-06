# P3-B preview verification

The first backend preview unit is accepted locally and in CI as of 2026-11-06 14:25 EST. Full P3-B is not done. The preview/confirm ticket, lifecycle, and watchlists stay later. No preview UI is built. Fields: [P3B_ORDER_PREVIEW_CONTRACT.md](P3B_ORDER_PREVIEW_CONTRACT.md).

## Accepted revision

- Commit `0aa62afd64a24bba2d659dc3044cebe6265e6929` on `codex/v2-order-preview-20261106`.
- [PR 18](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/18), stacked on PR 17. Codex review and CI accepted this backend preview. This note does not claim a formal GitHub approval.
- [CI run 42278953737](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42278953737): all 7 jobs succeeded. The browser job finished at 14:25 EST.
- `main` and the hosted service are unchanged. No merge and no deploy.

## CI results

- Backend, Python 3.12, fresh PostgreSQL 17: 251 passed, 2 optional browser modules skipped, 795 warnings, 84.00s.
- Frontend: 126 passed across 16 files. Lint and build passed. No preview UI is in that suite.
- Headless Linux browser: 5 passed, 1 hosted case excluded, 4 warnings, 74.68s. These are existing journey regressions. They do not cover an order-preview screen.
- Security, static analysis, dependency, and secrets checks passed.
- Existing migrations and grant proofs ran only on the isolated disposable CI instance. This slice adds no new repository migration and no new grant policy. The hosted database had no migration or grant change.

## Local results that still stand

Focused, `AUDIT_DATABASE_URL` only on the isolated database, Python 3.14:

`python -m pytest -q --tb=short tests/test_order_preview.py tests/test_order_preview_controls.py tests/test_order_preview_postgres.py`

61 passed, 247 warnings, 21.24s: 31 economics, 28 controls, 2 PostgreSQL.

Controls passed: auth 401, role 403, and input 422; halt, unknown, inactive, and non-stock; missing, zero, negative, future, stale, and non-finite quotes; a fixed snapshot clock, including another holding's book-cost concentration; confirmed MFA factor and challenge unchanged even with `X-Step-Up-Code`; SQL writes forbidden; no execute or provider path; `SnapshotClockError` propagates.

PostgreSQL proofs: exact `REPEATABLE READ READ ONLY`; no SQL writes, sequence advance, or table-count change, including no insert when `Asset` is missing; a concurrent cash and reserve update stays invisible until the next request.

Full backend on a fresh disposable PostgreSQL 17.11, Python 3.14:

`python -m pytest -q -ra --tb=short`

251 passed, 2 skipped, 830 warnings, 68.80s. The skips are the optional browser modules. That environment has no Selenium.

The full suite expects a fresh database. A reused disposable database is not a valid run, and the audit tests were not changed.

## Instance and boundary

Local runs used only loopback `127.0.0.1:54332`, synthetic database `p3b_preview`. Container `p3b-pg17-preview` was stopped and auto-removed at 14:18 EST. Development port 5433, the older browser instance on 54331, and the hosted database were not modified. This note has no credentials and no account rows.

The 20% band, freshness, and concentration thresholds are unchanged. The shared reference guard rejects non-finite quotes. `POST /orders/` still revalidates. The preview is indicative, non-binding, and is not an MFA authorization. No roadmap box is checked.
