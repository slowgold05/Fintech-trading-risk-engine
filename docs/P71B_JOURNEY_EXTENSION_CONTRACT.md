# Phase 7.1, second unit — partial fills, rejection, and idempotent resubmission

The original 7.1 scope named in [V2_BACKLOG.md](V2_BACKLOG.md) is: "search →
symbol → chart → preview → submit → order state → fill/cancel → portfolio,
both market and limit orders, partial fills, rejections, reservations,
duplicate submissions, and post-trade reconciliation of holdings/cash/
realized P&L/FIFO lots/ledger." The first 7.1 unit
([P7A_TRADER_JOURNEY_CONTRACT.md](P7A_TRADER_JOURNEY_CONTRACT.md)) covered
one limit buy/sell match plus one resting-then-canceled order — market
orders, partial fills, rejections, and duplicate submissions were not yet
exercised in a chained journey (each is already covered by its own
dedicated unit test elsewhere — `tests/test_orders.py`,
`tests/test_trades.py` — just not chained together the way a real trader
session would hit them back-to-back). This contract scopes that remaining
slice as a second test function in the same file, not a rewrite of the
first.

## What a market order resolves to when it partially fills

Read `app/services/order_book.py::place_order`: a market order that gets
some fill but not full fill ends with `remaining_quantity > 0` and
`status == "canceled"` (line ~100-103: `elif order.order_type == "market":
order.status = "canceled"`) — the unfilled remainder is simply dropped, not
left resting. The `trade_ids` list still contains whatever did execute.
This is the exact "partial fill" case to exercise: a market buy for more
shares than a single resting sell can supply.

## New test: `test_journey_partial_fill_rejection_and_duplicate_resubmission`

Added to `tests/test_p7a_trader_journey.py` (same file as the first 7.1
test, same `JRNY` symbol fixture helpers already in that file — reuse
`_recent_nyse_sessions`, seed a fresh `MarketSymbol`/`MarketBarDaily`/
`MarketQuoteCache` set under a different symbol, e.g. `"JRN2"`, so this
test's state never collides with the first test's `"JRNY"` fixtures).

Steps, all against one buyer and one seller (`auth_headers`, same pattern
as the first test):

1. **Seed a partial-fill setup**: seller opens a position via `POST
   /trades/` for `SELLER_QTY = 3` shares, then places a resting limit
   sell for `RESTING_SELL_QTY = 2` shares at a crossable limit price.
   Buyer places a **market** buy order for `BUYER_MARKET_QTY = 5` shares
   (more than the 2 resting). Assert the response: `status == "canceled"`
   (per the `place_order` behavior above — a market order's unfilled
   remainder is canceled, not left open), `trade_ids` has exactly one
   pair worth of fills (non-empty), and `remaining_quantity == 3`
   (`5 - 2`). Confirm via `GET /orders/{id}` that the same fields persist.
   Confirm via `GET /portfolio/` for the buyer that only 2 shares were
   actually acquired (not 5) — this is the assertion that proves the
   "partial fill" semantics, not just the order's own status field.
2. **Rejection case**: with the buyer's cash balance now reduced by step
   1's fill, attempt a second buy — a limit order sized so its notional
   exceeds the buyer's remaining buying power (read `GET /portfolio/`'s
   `summary.buying_power` first, then submit an order priced/sized to
   require strictly more than that). Assert `POST /orders/` returns
   `400` with `"Insufficient buying power"` in the response body (exact
   string from `order_book.py`), and assert via a fresh `GET /portfolio/`
   call that buying power is unchanged from before the attempt (the
   rejected order must not reserve or move anything).
3. **Duplicate submission**: submit one more, valid, small limit buy
   order with a fixed `Idempotency-Key`. Assert `201`/success and capture
   the response body and the resulting trade/order count
   (`db.query(Order).count()`, `db.query(Trade).count()`). Resubmit the
   exact same payload with the **same** `Idempotency-Key` header. Assert
   the second response has the same status code and an identical body to
   the first (the replayed response, per `app/services/idempotency.py`'s
   `execute_once`), and assert the order/trade counts in the database are
   unchanged from after the first submission — proving the duplicate was
   not re-executed.

## What this does not re-test

FIFO lot allocation and realized P&L are already covered in depth by
`tests/test_portfolio_attribution.py`; this unit does not duplicate that
math, it only confirms a partial fill inside a chained journey produces
the right *position size*, which is a different, narrower assertion (no
`avg_cost`/realized-P&L assertion beyond what the first 7.1 test already
checks).

## Test plan

One new test function as described above, added to the existing
`tests/test_p7a_trader_journey.py` file. No other file changes — no
application code should need to change for this unit; if implementing it
surfaces a real behavior mismatch against this contract's description of
`place_order`, stop and report the discrepancy rather than guessing a fix.
