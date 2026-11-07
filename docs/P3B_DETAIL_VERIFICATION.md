# P3-B order detail — verification (local review)

`GET /orders/{order_id}` on branch `codex/v2-order-detail-20261106` (base PR 19 `92b6b92900e5789c4a35697016dc5a5b69f3fa90`). Initial local-review record; not accepted. CI and PostgreSQL execution are pending. The first draft PR will record its revision and CI evidence. Full P3-B stays open. No frontend in this unit.

## Source (manager-reviewed)

`get_order_detail` in `app/routers/orders.py`: one read-only snapshot and clock; authenticated primitive owner id captured before the snapshot. Own-order and own-fill filters both apply. Exact six-place financial strings. Per-fill notional uses the existing half-up helper; PnL is the stored two-place column. Timestamps are UTC with a `Z` suffix. Fills are keyset pages, default 50, max 100, with a whole-order count. No matching, cash, auth-role, migration, grant, or dependency changes.

## Local results

After the fresh-quote fixture correction, the full local SQLite run finished: 248 passed, 16 skipped, 877 warnings, 70.15s, Python 3.14. `AUDIT_DATABASE_URL` was explicitly unset. Skips are 13 PostgreSQL checks (including the 2 new detail proofs) and 3 optional browser modules missing Selenium. That run includes all 8 new endpoint tests with the final fixture clock. Earlier focused runs: 8 passed, 81 warnings, 6.16s; orders/trades/ledger 27 passed, 206 warnings, 14.78s. PostgreSQL execution and CI remain pending. No browser was launched locally, no Docker instance was started, and no hosted data was touched.

## Pending — do not treat as passed

Two new PostgreSQL tests collect and have not executed. The local Docker daemon is stopped. They run only on fresh isolated CI PostgreSQL 17. The `AUDIT_DATABASE_URL` guard from `tests/test_order_preview_postgres.py` runs before any connection.

First proof: full `Numeric(18,6)` strings at `123456789012.345678`, unchanged sequences and table counts, and `REPEATABLE READ READ ONLY`. SQLite cannot store that precision; its fixture uses `123456.123456`. The PostgreSQL fixture keeps the full boundary.

Second proof: an order and fill update commits between the reader's order query and fill queries. That response must be the whole old snapshot. The next request must see the new state.

## Behavior held for acceptance

Privacy: missing and non-owned orders share one 404. Fills require `Trade.order_id == the selected order.id AND Trade.user_id == the authenticated owner id.` Immediate trades (`order_id` null) and counterparty rows stay out. No counterparty id. A positive `after_id` is an exclusive filter with no cursor lookup.

Precision and consistency: six-place quantities and prices; two-place notional and stored PnL. One snapshot covers the order, `total_fill_count`, and page. A later request is a new snapshot.

## After backend acceptance

Lifecycle UI, cancel-versus-fill race proof, chart integration, and watchlists come after this unit passes CI. The backlog stays unchanged until then. No deployment, hosted data, real credentials, or account rows.
