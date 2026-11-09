# Trade Impact Preview (first slice) verification

Adds `POST /portfolio/trade-impact` — the first slice of Phase 4.3's "signature feature," Trade
Impact Preview: cash, position-value, and weight before/after a hypothetical single trade.
Portfolio-volatility impact, VaR impact, and sector-exposure before/after (all named in the
roadmap's own illustrative table) remain separate, later slices, the same incremental pattern
`GET /portfolio/risk-metrics` already used across PRs #45, #47-#52.

## Two rounds with Grok, both driven by real contract errors I introduced

My first contract draft had **three** internal inconsistencies, all caught by Grok's first
implementation attempt rather than silently guessed past:

1. **Account-total formula.** The contract's formula literally said `total_after = total_before
   + (cash_after - cash_before)` — omitting the offsetting position leg — while a sentence two
   lines later claimed this was "equivalently... unchanged," which is only true if both legs are
   included. Grok implemented the mathematically correct version (both legs, with a runtime
   `assert total_after == total_before`) and flagged the written formula as wrong rather than
   reproducing it.
2. **Negative-weight clamp.** One formula line said `symbol_weight_after` is `0` when
   `position_after <= 0`, directly contradicting the contract's own stated design (the preview
   shows real, unclamped numbers, including negative ones, so a warning-triggering oversell is
   informative rather than hidden). Grok correctly did not clamp, and flagged the contradictory
   line.
3. **Incomplete-case field nulling.** The contract's "Computation" section said every field
   except `before.cash_balance`/`before.buying_power` goes `null` when another holding is
   unpriced, while the "Response shape" section separately invoked `GET /portfolio/allocation`'s
   "dollar amounts always pass through" precedent — a precedent that, applied literally, would
   keep `symbol_position_value` populated too. Grok followed the stricter, explicitly-stated
   rule and flagged the inconsistency with the invoked precedent.

I independently reviewed all three, agreed Grok's reasoning was correct in each case, and
rewrote the contract to resolve them properly — in particular, re-deriving a complete,
field-by-field incomplete-case rule (a field is `null` exactly when its own computation needs
`total_account_value`; several fields, including `symbol_position_value` and the *change* in
`total_account_value`, do not need it and should never be null) rather than the coarser
"everything except cash" rule I had originally written. I then sent a second, narrowly-scoped
follow-up task asking Grok to update only the incomplete branch to match; Grok implemented it
cleanly, restructuring the function to share the cash/position arithmetic between both status
branches rather than duplicating it.

## Implemented by Grok, independently verified by me

A new schema (`app/schemas/trade_impact.py`), a new, isolated module
(`app/services/trade_impact.py`), and one new route. `portfolio_valuation.py`,
`portfolio_allocation.py`, `performance_service.py`, and `portfolio_risk.py` are all
byte-identical to before this change (confirmed with `git diff --stat`, empty on all four).
**No database write occurs anywhere in this route** — confirmed by a test-level
`_book_fingerprint` helper (cash balance, order count, trade count, every holding's quantity/
avg_cost, and ledger-entry count) taken before and after the call and asserted identical, a
more thorough check than the simple cash-balance-only check I asked for.

- Warnings (`"insufficient_buying_power"`, `"insufficient_shares"`) correctly never short-circuit
  the computation — `test_insufficient_buying_power_warning_fires_without_rejecting` drives this
  to an extreme (buying 100 shares against $1000 cash) and asserts the full, real, unclamped
  numbers come back: a cash balance of `"-9000.00"`, a symbol weight of `"643.7500"%`, and a
  cash weight of `"-562.5000"%` — all still `200 OK`, proving the "never 422 solely for
  infeasibility" design directly.
- The incomplete-case branch correctly distinguishes "some *other* holding is unpriced" (the
  traded symbol's own dollars stay known and populated) from what would happen if the *traded*
  symbol itself were unpriced (`_position_before` returns `None` for position dollars in that
  case, which the `complete`-status check already guarantees cannot coincide with
  `status == "complete"`) — a correctly-handled edge case beyond what my contract explicitly
  called out, with no incorrect behavior introduced.

## Independent verification

- Re-derived the contract's buy reference (`AAPL`, cash `$1000`→`$800`, position `$300`→`$500`,
  total invariant at `$1600`, weights `62.5000%`→`50.0000%`/`18.7500%`→`31.2500%`) in a separate
  script before review. Matched exactly.
- Reviewed the full diff of all four touched files directly (not Grok's self-report), across
  both the initial implementation and the follow-up fix.
- `python -m pytest -q tests/test_trade_impact.py`: **6 passed** (all new).
- `python -m pytest -q` (full backend suite): **400 passed, 28 skipped**, the same 2
  pre-existing unrelated Windows-local SQLite-locking errors (documented since PR #27).
- Confirmed `portfolio_valuation.py`, `portfolio_allocation.py`, `performance_service.py`, and
  `portfolio_risk.py` are byte-identical to before this change.

## What changed

- `app/schemas/trade_impact.py`: new file, `TradeImpactRequest`.
- `app/services/trade_impact.py`: new file, `build_trade_impact_response`.
- `app/routers/portfolio.py`: new `POST /trade-impact` route.
- `tests/test_trade_impact.py`: new file, 6 tests.
- `docs/P4F_TRADE_IMPACT_PREVIEW_CONTRACT.md`: new contract, written by me before
  implementation, corrected twice after Grok caught three real internal inconsistencies, before
  any implementation code existed for the third one (the first two were already correctly
  implemented against my intent despite the wrong written formulas).

## What this unit does not do

Does not add portfolio-volatility impact, VaR impact, or sector-exposure before/after (each a
separate, later slice, all named in the roadmap's own illustrative table). Does not model
slippage, fees, or a bid/ask spread. Does not call the live order-matching engine or touch
`Order`/`Trade`/`Holding`/`LedgerEntry`. No frontend rendering. No merge or deploy is claimed.
