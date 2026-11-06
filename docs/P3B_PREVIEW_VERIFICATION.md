# P3-B preview verification

As of 2026-11-06 14:18 EST, `POST /orders/preview` is under review and verified locally. Preview-branch CI and PR review are pending. P3-B is not done: the preview/confirm ticket, lifecycle, and watchlists stay later. Fields: [P3B_ORDER_PREVIEW_CONTRACT.md](P3B_ORDER_PREVIEW_CONTRACT.md).

## Revision

- Branch `codex/v2-order-preview-20261106`, based on PR 17 final HEAD `c7a7a4eb4cc39ec4578c2f9eb503735dae2be392`.
- PR 16 (https://github.com/slowgold05/Fintech-trading-risk-engine/pull/16) and PR 17 (https://github.com/slowgold05/Fintech-trading-risk-engine/pull/17) are ready. All 7 CI jobs on those pull requests are green.
- `main` and the hosted service are unchanged. No merge, deploy, or hosted mutation.

## Final local checks

Focused run, `AUDIT_DATABASE_URL` only on the isolated database:

`python -m pytest -q --tb=short tests/test_order_preview.py tests/test_order_preview_controls.py tests/test_order_preview_postgres.py`

61 passed, 247 warnings, 21.24s: 31 economics, 28 controls, 2 PostgreSQL.

`tests/test_order_preview_controls.py` passed: roles 401/403/422; halt, unknown, inactive, and non-stock; missing, zero, negative, future, stale, and non-finite quotes; a fixed snapshot clock, including another holding's book-cost concentration; confirmed MFA factor and challenge unchanged even with `X-Step-Up-Code`; SQL writes forbidden; no execute or provider path; `SnapshotClockError` propagates.

The two PostgreSQL tests cover exact `REPEATABLE READ READ ONLY`, no SQL writes, sequence advance, or table-count change (a missing `Asset` is not inserted), and a concurrent cash and reserve update that stays invisible until the next request.

Full backend on a fresh disposable PostgreSQL 17.11:

`python -m pytest -q -ra --tb=short`

251 passed, 2 skipped, 830 warnings, 68.80s. The skips are only the optional browser modules. The main Python 3.14 environment has no Selenium. Headless browser regressions are pending CI.

The full suite expects a fresh database. A reused disposable database is not a valid run, and the audit tests were not changed.

## Scope and instance

Both runs used only loopback `127.0.0.1:54332`, synthetic database `p3b_preview`. Container `p3b-pg17-preview` was stopped and auto-removed after the final pass at 14:18. Development port 5433, the older browser instance on 54331, and the hosted database were not modified. This note has no credentials and no account rows.

No AWS, merge, deploy, migration, or grant change. Provider access and scaling stay outside this slice. Preview adds no migration and no dependency. The 20% band, freshness, and concentration thresholds are unchanged. The shared reference guard rejects non-finite quotes. `POST /orders/` still revalidates. The preview is indicative. No roadmap box is checked.
