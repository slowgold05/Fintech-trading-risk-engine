# P3-B next unit: GET /orders/{order_id}

Accepted backend read. Evidence: [P3B_DETAIL_VERIFICATION.md](P3B_DETAIL_VERIFICATION.md). Code `792aab73061fce3ced67fc03e7150e5e208b8d19` on `codex/v2-order-detail-20261106`. Draft [PR 20](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/20), stacked on PR 19. [CI 42330081496](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42330081496) passed all 7 jobs. Full P3-B stays open. This note does not accept lifecycle UI, the cancel-versus-fill race, or any phase. PR 19 remains the accepted ticket base (`90074df`, CI `42327832410`).

## Scope

Additive authenticated read on `app/routers/orders.py`: `GET /orders/{order_id}`. Keep the handler in the router unless it becomes unwieldy; no new service by default. Existing routes stay unaffected. One owner order plus that owner's recorded fills, inside one `consistent_read` and one `snapshot_clock` (`app/core/read_snapshot.py`). `read_at` is that clock. `SnapshotClockError` and other database failures propagate. No invented 200.

Unchanged: list, create, cancel, preview, and book bodies; `GET /trades/` (it omits `order_id`); matching; execution; auth; roles; cash; migrations; dependencies. No step-up, idempotency, sequence use, or provider calls. No `SELECT … FOR UPDATE`. PostgreSQL stays `REPEATABLE READ READ ONLY`. SQLite must not write; `query_only` stays unset. Capture `current_user.id` before `consistent_read` (it rollbacks first). Do not reload cash. Do not call `place_order` or `cancel_order`.

Auth is the existing router `get_current_user` (401). Missing and non-owned orders share 404 `{"detail":"Order not found"}`. `order_id` is a required positive integer; a non-integer or non-positive value is 422 via `Path(gt=0)`. `limit` outside 1..100 is 422. `after_id` may be absent. A supplied `after_id` that is non-integer or `<= 0` is 422. Any positive integer is a valid exclusive filter (`Trade.id > after_id`). Do not look up that cursor, and do not 404 or leak whether it belongs to another user or order.

## Body

Financial quantities, prices, notional, and PnL are exact decimal strings. `order_id`, `trade_id`, `total_fill_count`, `limit`, and `next_after_id` are numeric integers (`next_after_id` nullable). `has_more` is a boolean. `symbol`, `side`, `order_type`, `status`, `currency`, and timestamps are strings. `fills` is an array. Do not reuse `_order_out`: list `quantity` / `remaining_quantity` stay legacy JSON numbers. `filled_quantity` is `Decimal(quantity) - Decimal(remaining_quantity)`.

`status` is only `open`, `filled`, or `canceled`. `currency` is `"USD"`. `quantity`, `filled_quantity`, `remaining_quantity`: exact 6-decimal strings. `limit_price`: 6-decimal string or null. `created_at`, nullable `canceled_at`, and `read_at` are explicit UTC ISO-8601 with a `Z` suffix. Interpret naive database timestamps as UTC, then serialize. Do not emit a naive datetime. `fills` is this page only.

`open` with filled quantity above zero stays `open` (partial fill). `canceled` with filled quantity above zero stays `canceled` and still reports that quantity. No partial status, VWAP, fees, or final-partial flag. Canceled does not mean zero executed. A market remainder is already stored `canceled` (`place_order`).

## Fills

Inside the snapshot: one count and one page. Both use `Trade.order_id == order.id AND Trade.user_id == owner`. `order_id IS NULL` (immediate `POST /trades/`) is out. A counterparty row is out even if its `order_id` is this order. Create `trade_ids` includes both sides; those ids are not owned-fill proof. Response fills carry no counterparty id, identity, or cash.

`ORDER BY Trade.id ASC`. `limit` default 50, max 100. Read `limit + 1` rows to set `has_more`. When `has_more`, `next_after_id` is the last returned `trade_id`. `total_fill_count` counts the whole order, not the page. A short page is not full history. No per-fill query.

The order row, count, and page in one response share that snapshot. A later request is a new snapshot: new fills can change `total_fill_count` and the page. Do not claim totals are stable across requests.

Each fill: `trade_id`, `quantity` (6), `execution_price` (6, `price_at_execution`), `notional` (2, existing `notional_amount`: cent, `ROUND_HALF_UP`, prec 50; `1.000000 * 10.005000` is `10.01`), `realized_pnl` (2, stored column, not recomputed), `executed_at` UTC `Z`. No `realized_pnl_pct`.

## Verified acceptance

Fresh open, no fills. Open partial. Filled. Market canceled with zero fills, and market canceled after a partial. Limit canceled after a partial. Own versus other user versus unknown id versus 401; the two misses share one 404 body. Null `Trade.order_id` excluded. Counterparty trade excluded when `order_id` is this order; both owner filters always apply, and no counterparty id is returned. Absent `after_id` allowed. Two requests over unchanged fixtures return consecutive nonoverlapping pages; each request has its own snapshot, and new fills can change later totals. `limit` and `after_id` `<= 0` or non-integer are 422. A positive cursor that matches no owned fill returns an empty page without a lookup leak. Same response: order, `total_fill_count`, and page agree. A second request may observe new fills. Half-cent per-fill rounding, large 6-decimal values, true zero as `0.000000` / `0.00`. Timestamps match `YYYY-MM-DDTHH:MM:SSZ` with fractional seconds when the source has them, always suffixed `Z`. Read-only SQL and unchanged sequences. On isolated PostgreSQL, a commit after the snapshot starts stays invisible in that response. These cases are verified in [P3B_DETAIL_VERIFICATION.md](P3B_DETAIL_VERIFICATION.md), except the separate cancel-versus-fill race below. No provider, execution, or MFA calls.

`cancel_order` locks `MarketSymbol`, then the user, then the order, and returns 409 when status is not `open`. This note does not verify a concurrent PostgreSQL proof of that race and does not claim it tested. This GET does not take those locks.

## Paths

Actual scope of this accepted backend unit: `app/routers/orders.py` adds `get_order_detail` only. New tests are `tests/test_order_detail.py` and `tests/test_order_detail_postgres.py`. `notional_amount` is called as-is; `app/services/trade_execution.py` is not edited. `app/core/read_snapshot.py`, models, `app/services/order_book.py`, matching, cash, auth roles, migrations, grants, and dependencies stay unchanged. Legacy list, create, cancel, preview, book, and immediate trade paths stay unchanged.

A cancel-versus-fill race proof is a separate future unit. The detail snapshot test does not prove it.
