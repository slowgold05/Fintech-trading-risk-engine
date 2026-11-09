# Phase 7.1, second unit — verification

Contract: [P71B_JOURNEY_EXTENSION_CONTRACT.md](P71B_JOURNEY_EXTENSION_CONTRACT.md).

## Diff scope

Only `tests/test_p7a_trader_journey.py` changed — one new function,
`test_journey_partial_fill_rejection_and_duplicate_resubmission`, appended
after the existing test. The original test function is byte-for-byte
unchanged (`git diff` shows the new function as a pure addition, no
context-line changes above it). No application code changed, matching the
contract's instruction to report rather than fix if the real behavior
disagreed with the contract's description — it did not disagree.

## Logic review against the contract

1. **Partial fill**: seller opens 3 shares, rests a limit sell for 2 at
   `MATCH_LIMIT`. Buyer's market buy for 5 returns `status == "canceled"`
   (confirms the `place_order` behavior read directly from
   `app/services/order_book.py` before writing the contract: a market
   order's unfilled remainder is canceled, not left resting), exactly 2
   `trade_ids` (one buy/sell pair for the 2-share slice that did execute),
   and `remaining_quantity == 3` (`5 - 2`). The follow-up `GET
   /orders/{id}` confirms the same status/remainder persisted, and
   `GET /portfolio/` confirms the buyer's actual position is 2 shares —
   the assertion that proves this is a real partial fill, not just a
   status-field check.
2. **Rejection**: computed `oversized_qty` directly from the buyer's live
   `buying_power` (`// limit_price + 1`, with an assertion that the
   resulting notional is strictly greater before submitting — guards
   against a future rounding change silently making this case stop
   testing what it claims to). Confirmed `400` with the exact
   `"Insufficient buying power"` string, and confirmed buying power is
   byte-for-byte unchanged afterward (no partial reservation leaked
   through on the rejected attempt).
3. **Duplicate resubmission**: fixed `Idempotency-Key`, same payload
   twice. Second response's status code and full JSON body match the
   first exactly, and `Order`/`Trade` row counts are unchanged between
   the two calls — confirms the second call was a pure replay via
   `app/services/idempotency.py`'s `execute_once`, not a second
   execution.

Grok's own run flagged one detail worth recording: `GET /orders/{id}`
exposes trade references under a `fills` list (`fill["trade_id"]`), not
under the create response's `trade_ids` field name — the test correctly
cross-references `persisted_body["fills"][0]["trade_id"] ==
market_body["trade_ids"][0]` rather than assuming the same key name on
both endpoints. This was verified by reading the actual response, not
assumed from the contract.

## Test verification

Independently reran (not trusting Grok's self-report alone), fresh
`--basetemp` each time, `AUDIT_DATABASE_URL` unset:

- `tests/test_p7a_trader_journey.py` (both functions): **2 passed**.
- Full backend suite: **511 passed, 29 skipped, zero failures.**

This completes the remaining locally-reachable slice of roadmap 7.1 named
in `V2_BACKLOG.md` — partial fills, rejection, and duplicate submission are
now exercised inside a chained trader journey, not only in isolated unit
tests. FIFO/realized-P&L reconciliation depth is intentionally left to its
existing dedicated coverage (`tests/test_portfolio_attribution.py`), per
the contract's "what this does not re-test" section.
