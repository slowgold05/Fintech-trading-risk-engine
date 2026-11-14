# Current delivery sequence, Stage 4 — quote identity recheck at confirmation

Roadmap: [Sentinel_Markets_2_0_Roadmap.md, Stage 4](../Sentinel_Markets_2_0_Roadmap.md#4-quotes-and-paper-trade-behavior).

## What already exists, checked before writing this — read this section before changing anything

This app's order matching is **not** quote-based execution: a limit
order fills against actual opposing resting orders' own limit prices
(`app/services/order_book.py::place_order`, `allocate_slices`), never
against `MarketQuoteCache`. The quote cache is read at submission time
only for one purpose today: the buy-side stock-concentration risk check
(`reference_price = db.get(MarketQuoteCache, payload.symbol).price`,
used to compute `risk_price` for `require_stock_concentration`) — and
that read is already fresh (not stale) at submission time. Buying-power
and holdings checks are also already freshly rechecked at submission,
independent of any quote.

**This means the real gap this unit closes is narrower than it might
sound:** it is not about preventing an unsafe fill (fills were never
quote-driven, and risk checks already use a fresh quote). It is about
giving the trader an explicit, honest signal when the market reference
price they saw in `POST /orders/preview` has moved by the time they
confirm — so a concentration-risk assessment they silently relied on
from the preview doesn't quietly change out from under them. Document
this honestly in the verification doc; do not overstate this as a
new safety mechanism for fills, which were already safe.

## What this unit adds

1. **`app/schemas/order.py`**: add one new optional field to
   `OrderCreate`: `expected_quote_observed_at: datetime | None = None`.
   Optional and defaulting to `None` — every existing caller (tests,
   any future client that doesn't send it) is completely unaffected.
2. **`app/services/order_preview.py`**: no change needed — it already
   returns `quote_observed_at` (via `_utc_z(observed_at)`) in its
   response. A real client would pass that exact string back as
   `expected_quote_observed_at` on the follow-up `POST /orders/` call.
3. **`app/services/order_book.py::place_order`**: when
   `payload.expected_quote_observed_at is not None`, read the current
   `MarketQuoteCache` row for `payload.symbol` **once**, before any
   other work in the function (right after the existing
   `MarketSymbol` lookup, since both need the same early-exit-on-missing-data
   shape). Compare `payload.expected_quote_observed_at` (a Pydantic
   `datetime` — it will arrive timezone-aware if the client sent a `Z`
   suffix, since `MarketQuoteCache.quote_at` is stored as a **naive**
   `DateTime` column, strip `.replace(tzinfo=None)` before comparing,
   do not compare an aware value against a naive one) against that
   quote row's `quote_at`. Three cases:
   - No quote row exists for the symbol at all: reject with
     `HTTPException(400, "No current quote available to confirm against")`.
   - A quote row exists but its `quote_at` does not equal the expected
     value (or is `None` while a value was expected): reject with
     `HTTPException(400, "Quote has changed since preview; request a new preview")`.
   - It matches exactly: proceed exactly as `place_order` already does
     today — no other behavior changes.
   When `expected_quote_observed_at` is `None` (the default, every
   existing test and caller), skip this whole check — `place_order`'s
   existing behavior is completely unchanged for that case.

## Tests

New file `tests/test_p9c_quote_recheck.py`:

1. Seed a symbol with a `MarketQuoteCache` row at a known `quote_at`.
   Preview an order; capture `quote_observed_at` from the response.
   Submit the real order with `expected_quote_observed_at` set to that
   exact value: succeeds exactly as it would without the field (same
   status, same fill behavior) — proving the matching-value case is a
   no-op on top of existing behavior.
2. Same setup, but before submitting, update the `MarketQuoteCache`
   row's `quote_at` to a different value (simulating a refresh between
   preview and confirm) and submit with the **old**
   `expected_quote_observed_at`: `400`, the exact
   `"Quote has changed since preview; request a new preview"` message,
   and confirm via a follow-up read that no order/trade/cash-movement
   row was created — the rejection must happen before any mutation.
3. Submit an order for a symbol with **no** `MarketQuoteCache` row at
   all, with `expected_quote_observed_at` set to some value: `400`,
   the exact `"No current quote available to confirm against"` message.
4. Submit an order with `expected_quote_observed_at` omitted entirely
   (the default `None`): behavior is byte-for-byte identical to every
   existing order test in `tests/test_orders.py` — do not re-test every
   existing case, just confirm one representative order still succeeds
   normally without the new field, proving the opt-in design doesn't
   change default behavior.

## What this does not do

Does not change how orders actually match or fill (still governed by
resting orders' own limit prices, untouched). Does not change the
buying-power, holdings, or concentration checks themselves — only adds
an earlier, optional rejection before those checks run when the caller
opts in and the quote has moved. Does not touch `preview_order` itself.
Does not touch the frontend (no existing frontend code calls
`POST /orders/` with this field yet — that's separate, later UI work,
not required for this backend contract to be complete and tested).
