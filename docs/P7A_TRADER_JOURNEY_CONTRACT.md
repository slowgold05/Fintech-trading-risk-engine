# Phase 7.1 — consolidated trader-journey regression test, contract

Roadmap 7.1 item: "Test search → symbol → chart → preview → submit → order
state → fill/cancel → portfolio." Every individual endpoint in this chain
already has extensive focused test coverage elsewhere (`tests/test_orders.py`,
`tests/test_market_history.py`, `tests/test_trades.py`, etc.). No existing
test chains them together as one journey against one consistent account and
asserts that state is consistent *across* the chain — that is the actual gap
this unit closes, and the only thing in scope. This is a new test file, not
an application-behavior change: no file under `app/` may change.

## New file

`tests/test_p7a_trader_journey.py` — one new test module, using the existing
`client`, `auth_headers`, and `db_session` fixtures (see any existing test
file, e.g. `tests/test_orders.py`, for their exact signatures — copy the
existing import and fixture-usage style, do not redefine them).

## Seed data (inside the test, using `db_session` directly — no new fixture
file, no provider call)

- One `MarketSymbol` row, symbol `JRNY`, exchange `NYSE`, active, non-ETF,
  non-test (copy the exact field set `tests/test_market_history.py` uses
  around its line ~51 `db.add(MarketSymbol(...))` call — read that file
  first).
- At least 5 `MarketBarDaily` rows for `JRNY`, provider `yahoo`,
  `adjustment_type="raw"`, `quality_status="valid"`, consecutive NYSE trading
  sessions ending at-or-before "today" in the test, distinct increasing
  closes (read `tests/test_market_history.py` around its `MarketBarDaily(...)`
  calls for the exact required field set).
- One `MarketQuoteCache` row for `JRNY` so the order book's reference-band
  and concentration checks have a quote to read (copy the exact field set an
  existing order test uses to seed this, e.g. `tests/test_orders.py` — read
  it first for the precise model fields).
- Two users via `auth_headers(email, password)` (see `tests/conftest.py`):
  `buyer` and `seller`, e.g. `auth_headers("journey-buyer@example.com", "password123")`
  and `auth_headers("journey-seller@example.com", "password123")`. Registration
  defaults every new user to role `trader` — no separate role step is needed.

## The single journey, as one test function

`test_full_trader_journey_search_to_portfolio(client, auth_headers, db_session)`:

1. **Search**: `GET /market/universe?search=JRNY` as `buyer`. Assert `JRNY`
   is in the results.
2. **Symbol / chart**: `GET /market/symbols/JRNY/history?interval=1d&range=2y&provider=yahoo&adjustment_type=raw`
   as `buyer`. Assert the response's `bars` list is non-empty and its closes
   match the seeded closes in order.
3. **Preview**: `POST /orders/preview` as `buyer` for a limit buy of `JRNY`
   at a price inside the seeded quote's reference band. Assert the preview
   succeeds and writes no row (query `Order`, `Trade`, `CashMovement`,
   `Holding` counts before and after — assert unchanged).
4. **Submit (resting side)**: as `seller`, `POST /orders/` a limit sell of
   `JRNY` at the same limit price, with an `Idempotency-Key` header. This is
   the resting order the buy will match against. Assert `201`/success and
   capture the resulting `order_id`.
5. **Submit (matching side)**: as `buyer`, `POST /orders/` the limit buy
   previewed in step 3, at the same price, with its own distinct
   `Idempotency-Key`. Assert it matches immediately against the seller's
   resting order (check `trade_ids` in the response is non-empty).
6. **Order state**: `GET /orders/{order_id}` for both the buyer's and the
   seller's order IDs. Assert both show status `"filled"` (confirmed literal
   from `app/services/order_book.py`).
7. **Fill/cancel branch — cover both**:
   - 7a. Confirm the match above already demonstrates the fill path (no
     separate action needed beyond step 6's assertion).
   - 7b. Separately, as `buyer`, place one more limit buy for `JRNY` priced
     low enough that it does not cross any resting ask (e.g. well below the
     price used in steps 4-5, but still inside the seeded quote's reference
     band so the order is accepted rather than rejected), so it rests open
     and unmatched. `POST /orders/{order_id}/cancel` it, and assert
     `GET /orders/{order_id}` now shows status `"canceled"` and that
     `buyer`'s reserved cash was released (check `GET /portfolio/` buying
     power before and after this specific sub-step).
8. **Portfolio**: `GET /portfolio/` as `buyer`. Assert the `JRNY` position
   from step 5's fill is present with the correct quantity and average cost,
   and `GET /trades/` as `buyer` shows the matching trade with the correct
   notional. `GET /portfolio/` as `seller` similarly reflects the reduced
   `JRNY` holding (or the opened short/zero position, whichever this
   codebase's matching model produces — read `tests/test_trades.py` for how
   an existing test seeds the seller's starting position so the assertion is
   concrete, not speculative).

## What this explicitly does not do

- Does not re-test any single endpoint's internal validation, error paths,
  or edge cases — those stay in their existing dedicated test files.
- Does not call any real market-data provider (Alpha Vantage, Yahoo) — all
  data is seeded directly into the test database, exactly like every
  existing test in this codebase.
- Does not touch `app/` — this is a pure test-only addition. If a step in
  this journey turns out to be impossible to assert without an application
  change, stop and report that back rather than loosening the assertion or
  modifying application code — that would be a real Phase 7.1 finding worth
  its own follow-up unit, not something to paper over in this one.
- Does not attempt Research Desk, Forecast Lab, compliance, or any route
  outside the core trading journey named in roadmap 7.1.

## Required outcome

- The new test passes deterministically, with no `sleep`/timing dependence,
  against SQLite (the existing default local test database) and does not
  depend on `AUDIT_DATABASE_URL` being set.
- The full existing suite (`python -m pytest -q`) still passes with no
  change to any existing test's count or outcome — this unit only adds
  tests, it does not modify any.
