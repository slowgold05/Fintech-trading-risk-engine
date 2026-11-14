# Phase 7.1 trader-journey regression test — verification

First Phase 7 unit. Implements [P7A_TRADER_JOURNEY_CONTRACT.md](P7A_TRADER_JOURNEY_CONTRACT.md):
one consolidated end-to-end test chaining search, chart, preview, submit,
order state, fill, cancel, and portfolio against a single seeded account —
closing the gap the roadmap's 7.1 item names, which no existing per-endpoint
test closes on its own.

## Implemented by Grok, independently verified by me

- `tests/test_p7a_trader_journey.py` (new): one test function,
  `test_full_trader_journey_search_to_portfolio`.

## Independent verification

- Reviewed the full file directly (not Grok's self-report). Confirmed
  `git diff --stat` shows only this one new test file; no file under `app/`
  or any existing test file was touched.
- Confirmed every status literal and field name used in the assertions
  against the real source, not assumed: `"eligible"`
  (`app/services/order_preview.py:93,165,168,406`), `"filled"` and
  `"canceled"` (`app/services/order_book.py`).
- Confirmed the seller-side design choice is correct and is explained in a
  comment: `POST /orders/` rejects a limit sell with no holding, so the test
  opens the seller's position with `POST /trades/` first, the same pattern
  `tests/test_orders.py` already uses. This is not a shortcut around the
  journey — opening a position is a prerequisite for a sell order to exist
  at all, in or out of a test.
- Confirmed the post-cancel resting order (`RESTING_LIMIT = 85`) cannot
  cross: the earlier resting ask was fully consumed by the matching fill, so
  there is nothing left at or below 100 for an 85 buy to cross, and 85 is
  still inside the seeded quote's reference band (80-120 at a 20% band
  around a 100 quote) so the order is accepted rather than rejected.
- Confirmed the cancel-release assertion
  (`released == FILL_QUANTITY * RESTING_LIMIT`) correctly isolates the
  resting order's own reservation, since buying power is read once while
  that order is still open and once after it is canceled, with no other
  mutation between those two reads.
- Confirmed the preview step's own assertion that `Order`, `Trade`,
  `CashMovement`, and `Holding` row counts are unchanged, which is the real
  test that preview does not mutate state (not just a 200 status code).
- Confirmed dates are seeded via `is_nyse_trading_day`-filtered real NYSE
  sessions ending at-or-before "today," not hardcoded literals — so the
  test stays correct regardless of what day it runs.
- Ran independently, not just trusting Grok's own report:
  - `python -m pytest -q tests/test_p7a_trader_journey.py` — **1 passed**
    (fresh temp venv, fresh `--basetemp`).
  - `python -m pytest -q -rs --tb=line` (full suite) — **501 passed, 29
    skipped** (up from 500 passed/29 skipped before this unit; the 29 skips
    are the same already-understood categories — browser/selenium, pandas,
    PostgreSQL-only — as every prior run this session). No existing test's
    outcome changed.

## What this unit does not do

Does not re-test any single endpoint's validation or error paths (those
stay in their existing dedicated files). Does not call a real market-data
provider. Does not touch `app/`. Does not attempt Research Desk, Forecast
Lab, or compliance routes — out of scope for roadmap 7.1's core trading
journey. Does not attempt 7.2 (real browser/accessibility pass), 7.3's
deployed-environment items, or 7.4 (staged rollout) — those remain explicitly
open, same as Phase 0's own still-blocked gates.
