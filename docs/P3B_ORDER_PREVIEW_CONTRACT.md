# P3-B contract: POST /orders/preview

The first backend preview unit is accepted locally and in CI. Evidence: [P3B_PREVIEW_VERIFICATION.md](P3B_PREVIEW_VERIFICATION.md). At that backend revision there was no preview UI. The ticket is now accepted in [P3B_TICKET_VERIFICATION.md](P3B_TICKET_VERIFICATION.md). Full P3-B is not done: lifecycle and watchlists stay later. Indicative, non-binding read-only preview. It is not an MFA authorization. `POST /orders/` revalidates. Preview reserves nothing and is not an execution guarantee. `eligible` does not authorize step-up.

## Route and snapshot

`POST /orders/preview` on `app/routers/orders.py` (mounted in `app/main.py`), same `@limiter.limit("60/minute")` as `create_order`. Body is `OrderCreate` (`app/schemas/order.py`). Auth matches `create_order`: `get_current_trader` (`app/core/security.py`). 401, role 403, 422, and 429 stay HTTP errors. No `Idempotency-Key`, no `execute_once`. `X-Step-Up-Code` is ignored.

Call `consistent_read`, then `snapshot_clock`, then reload `User` by the authenticated id (`app/core/read_snapshot.py`). That clock is `read_at` and the `now` used for every preview quote check. `consistent_read` rollbacks first, so the dependency user is stale. Read halt, symbol, the order quote, asset, book, owner balances, maker settlement inputs, and the MFA factor only in that block. PostgreSQL is `REPEATABLE READ READ ONLY`: no `SELECT … FOR UPDATE`. SQLite must still not write; `query_only` stays unset. `SnapshotClockError` and other database failures propagate. Do not invent a 200 for them.

## Status

Business outcomes are HTTP 200. Meaning is not “every current 503”:

- `blocked`: halt and other control denials. Keep the owner’s current `detail`: halt `SM-PT-01`, unknown or inactive symbol, non-stock symbol, band `SM-PT-02`, concentration `SM-PT-03` / `SM-PT-05`, `"Insufficient buying power"`, `"Insufficient buying power after matching"` when the buyer is the owner, `"Not enough holdings to sell"` for the owner, and `"Trade value must be at least $0.01"`.
- `unavailable`: the reference quote is missing or unusable, or a taken maker cannot settle. Quote text stays `"Usable reference quote unavailable (SM-PT-02)"`. Settlement text is only `"Unavailable liquidity"`.
- `reason` is null only when `eligible`.

Auth and database failures are not statuses.

## Shared checks

`require_trading_open` (`app/services/pretrade_controls.py`) locks `TradingHaltState.id == 1`. Extract `trading_halt_reason(state) -> str | None` for `settings.trading_halted or state is None or state.halted`. The locked function still raises 503 from that string. Preview reads id 1 with no lock and maps the reason to `blocked`.

Add keyword-only `now: datetime | None = None` to pure `_price_band_problem` and to `require_stock_concentration`. Default `None` keeps today’s wall clock: `datetime.now` for the future-quote test and `_freshness(quote, "hot")` with no `now` (`app/services/market_cache_service.py` already accepts `now`). A passed `now` is that same instant for the future test and `_freshness(..., now=now)`. Thresholds stay 20% and hot-stale. `require_price_in_band` forwards `now`. Execution callers omit it. `check_open_order_price_bands` omits it. Preview passes `snapshot_clock`, including each other holding inside concentration. No second freshness policy.

`require_stock_concentration` accepts a missing asset explicitly (`asset: Asset | None`). `None` means held quantity 0 and pending target exposure 0, with no `asset_id IS NULL` query. Other holdings still use the quote mark, or `holding.avg_cost` when `_price_band_problem(quote, None, now=now)` fails. Execution still passes its real `Asset` after insert. Preview never `add`s or `flush`es an `Asset`, and never builds a detached stand-in.

## Match extraction

Two pieces, both free of risk policy:

- `resting_makers_select(asset_id, user_id, payload)` in `app/services/order_book.py`: opposite `open` orders, `user_id != owner`, buy price ascending or sell descending, then `Order.id`. Limit crossing stays `maker.limit_price <= limit` (buy) or `>=` (sell). Market crossing stays true. `place_order` adds `.with_for_update()`. Preview does not.
- Pure `allocate_slices(quantity, makers) -> list[tuple[Order, Decimal]]`: walk in that order, take `min(left, remaining)`, stop when filled. Each item is the original maker object and the allocated quantity. The execution price stays that maker's limit and is not part of the tuple. Maker identity is internal and is never exposed to clients. No portfolio mark and no reference quote.

`place_order` uses the slices for the market-buy reservation sum and for match quantities. It still locks the symbol and users, inserts a missing `Asset`, inserts the order, and, in today’s order, band-checks, calls `execute_fill`, updates residuals, and runs the post-fill `reserved_cash` check. Market remainder stays `canceled`. Do not call `place_order` and roll it back. Do not move those writes or checks into a new framework.

## Preview economics

Reuse `notional_amount` per slice (`app/services/trade_execution.py`: cent, `ROUND_HALF_UP`, prec 50), then sum those cents. Two raw half-cent products can total `0.02`. Do not quantize after combining a price level.

Gate order matches `place_order`: halt, active symbol, band on the order price (`None` price checks usability only), asset type, owner funds or shares, buy concentration on the full quantity (`reference_price = quote.price`, `risk_price = limit or reference * 1.20`), then slices. First failure wins. Makers past the exhausted quantity are ignored. Any failure nulls all four estimates; earlier good slices are not a partial `eligible`.

Owner buy reservation is `notional_amount(full quantity, limit)` for a limit, else the sum of taken slice notionals. It must be `<= cash_balance - reserved_cash`. Owner sell quantity must be `<= holding.quantity - reserved_shares`. A missing holding is zero. Then simulate `execute_fill` inputs on running balances, in buy-fill then sell-fill order: notional `<= 0` blocks; a buy needs `notional <=` that buyer’s running cash; a sell needs `qty <=` that seller’s running holding. Apply cash and share deltas. Then the buyer’s open-buy reservation, with that order’s contribution replaced by `notional_amount(new_remaining, limit)`, must be `<=` running cash. The new limit order is included. A market order is not, because submit inserts it `canceled`. One maker with several taken orders accumulates on one cash balance, one holding quantity, and one reservation aggregate.

Read those maker inputs in the snapshot: cash, this asset’s holding quantity, and aggregate open-buy `reserved_cash`. No lots, FIFO, P&L, or ledger. Owner failures keep the owner messages above. A maker cash, share, or post-fill reservation failure is `unavailable` / `"Unavailable liquidity"`. The body has no counterparty id, order id, or balance.

## Step-up

Preview may `SELECT` `confirmed_factor` and must not call `consume_totp` (`app/services/mfa.py`) or write a factor or login challenge. Submit still enforces enrollment and the code. `step_up_required` is separate from `status`. Limit notional is `notional_amount(quantity, limit_price)` even when the quote is unusable. Market notional uses `quote.price * 1.20` only when that quote passes the usability check at `read_at`; otherwise `step_up_required` is null, not false. When the notional is known, the flag is true only if it meets `settings.large_order_step_up_notional` and (`settings.mfa_required` or a confirmed factor exists).

## Response

Quantities and prices are six-decimal strings. Money is two-decimal strings. Null is unknown. Eligible zero liquidity uses `"0.000000"` and `"0.00"`, not null. No ladder, fee, P&L, or VaR.

- Identity: `symbol`, `side`, `order_type`, `quantity`, `limit_price` (null on market).
- `read_at`: snapshot clock actually applied, naive UTC with `Z`. `quote_observed_at`: that symbol’s `MarketQuoteCache.quote_at`, or null. It is not `read_at`.
- `status`, `reason`, `step_up_required`.
- `buying_power`: unclamped `cash_balance - reserved_cash` on every 200, including a negative reserve deficit.
- `sell_available`: holding minus reserved sells when the symbol resolves; `"0.000000"` when the stock row is absent; null when the symbol is unknown, inactive, or not a stock.
- Eligible only: `initial_reservation` (buys, including `"0.00"` when a market buy takes nothing; null on sells), `estimated_fill_quantity`, `estimated_fill_notional`, `unfilled_quantity`. No price is invented for the remainder. Market unfilled quantity is canceled, not resting.

On `blocked` or `unavailable`, those four estimates are null.

## Scope and tests

Backend preview only. No provider HTTP, migrations, grants, deploy, UI, Dashboard, or `POST /trades` changes, and no change to band width, freshness tiers, or the book-cost fallback. Existing order, ledger, idempotency, and trade suites stay green, including default wall-clock execution.

Cover limit and market buy and sell; no, partial, and full liquidity; crossing and price-time, excluding self; owner reservations and insufficient funds or shares; half-cent totals and whole-order dust rejection; missing, non-positive, future, and stale quotes; halt as `blocked`; existing and missing `Asset`; concentration book-cost marks; trader-only access. Also: a known insolvent maker (cash or shares) and a second slice that fails only after an earlier slice by the same maker updates running cash, shares, and reservation; both return `"Unavailable liquidity"`, null estimates, and no counterparty fields. MFA `last_counter` and challenge `consumed_at` stay unchanged even if a step-up code is sent. Assert no SQL writes or sequence changes, a repeated snapshot returns the same body, and a PostgreSQL commit during the read stays invisible. A quote that is fresh on the wall clock but stale or future at `snapshot_clock` follows the snapshot, and `read_at` is that clock.
