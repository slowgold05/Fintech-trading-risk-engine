# Current delivery sequence, Stage 4 — quote identity recheck, verification

Contract: [P9C_STAGE4_QUOTE_RECHECK_CONTRACT.md](P9C_STAGE4_QUOTE_RECHECK_CONTRACT.md).

## Diff scope

`app/schemas/order.py`, `app/services/order_book.py`, and the new
`tests/test_p9c_quote_recheck.py` — exactly the files granted.
`app/services/order_preview.py` untouched, confirmed by `git status`.

## Logic review

- `OrderCreate` gains `expected_quote_observed_at: datetime | None = None` —
  purely additive, default `None` for every existing caller.
- `place_order`'s new check sits immediately after the existing
  `MarketSymbol` lookup, before any other read or write — confirmed by
  reading the diff directly, matches the contract's required insertion
  point exactly (both errors fire before `require_price_in_band`, the
  asset lookup, or any mutation).
- The naive/aware datetime handling is correct:
  `payload.expected_quote_observed_at.replace(tzinfo=None)` strips
  whatever timezone Pydantic attached when parsing a `Z`-suffixed
  client value, before comparing against `MarketQuoteCache.quote_at`'s
  own naive value — exactly the subtlety the contract flagged.
- Both error messages match the contract's exact wording
  (`"No current quote available to confirm against"`,
  `"Quote has changed since preview; request a new preview"`).

## Test verification

Independently reran (not trusting the self-report alone — Grok's own
test run was blocked by the permission classifier on a wrong venv path
before it could execute, so this review's run is the only one that
actually happened), fresh `--basetemp` each time, `AUDIT_DATABASE_URL`
unset:

- `tests/test_p9c_quote_recheck.py` + `tests/test_orders.py`: **19
  passed** — the 4 new cases plus all 15 pre-existing order tests
  unchanged.
- Full backend suite: **547 passed, 39 skipped, zero failures.**

Each new test maps to the contract one-to-one: a matching
`expected_quote_observed_at` places the same order as the
field-omitted case; a changed `quote_at` rejects with the exact message
and zero mutation (`Order`/`Trade`/`CashMovement` counts unchanged,
confirmed before and after the rejected call); a symbol with no quote
row at all rejects with the other exact message; and omitting the field
entirely reproduces default `place_order` behavior unchanged.

## Honest scope note, carried from the contract

This does not add new protection to how orders actually fill — limit
orders were already matched against real resting orders' own prices,
never the quote cache, and buying-power/concentration checks already
reread fresh data at submission. What this closes is a transparency
gap: a trader who relied on a specific preview's quote now gets an
explicit, clear rejection if that quote moved before they confirmed,
rather than silently having their concentration-risk assessment
recomputed against a different, unseen quote.
