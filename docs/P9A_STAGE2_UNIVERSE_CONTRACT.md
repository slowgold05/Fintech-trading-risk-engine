# Current delivery sequence, Stage 2 — focused market universe

Roadmap: [Sentinel_Markets_2_0_Roadmap.md, Stage 2](../Sentinel_Markets_2_0_Roadmap.md#2-focused-market-universe).
Prerequisite (done): [P8B_SP500_CONSTITUENTS_VERIFICATION.md](P8B_SP500_CONSTITUENTS_VERIFICATION.md).

## What already satisfies part of this stage, checked before writing this

`GET /market/overview` (`app/routers/market.py`) already renders the
four index ETF-proxies (`SPY`/`QQQ`/`DIA`/`IWM`) in a dedicated `trends`
section with a `source_symbol` (the real ETF) distinct from `symbol`
(the display index code, e.g. `SPX`) and a `name` field — this is
already "separately labeled as an index, not a tradeable security" in
substance. **Do not change `INDEX_SYMBOLS`, `SECTOR_SYMBOLS`, or
`market_overview` in this unit.** One naming note, not fixed here: the
roadmap's own Stage 1 benchmark list names "Nasdaq Composite," while the
existing code's `QQQ` proxy is labeled "Nasdaq 100" — a real, different
index. This mismatch is flagged, not resolved, in this unit.

## What this unit actually changes

`GET /market/universe`'s discovery/search query, currently:

```python
query = db.query(MarketSymbol).filter(MarketSymbol.is_active.is_(True))
if search:
    ...
```

Add one further filter: the result set only includes symbols whose
ticker is in `app.services.sp500_constituents.load_sp500_constituents()`'s
ticker set — **in addition to**, not instead of, the existing
`is_active` filter and the existing search-term logic. Load the S&P 500
ticker set once per request (a small, in-memory `set` comprehension over
`load_sp500_constituents()`'s ~503 rows — no new caching layer, this CSV
read is already cheap and synchronous) and filter with
`MarketSymbol.symbol.in_(that_set)`.

**This is a search/discovery narrowing only.** No other route changes:
`GET /market/symbols/{symbol}/history`, `POST /orders/`,
`GET /portfolio/`, and every other existing route that reads a
`MarketSymbol` by its own ticker remain completely unrestricted by S&P
500 membership — a symbol a user already holds, or that the test suite
seeds directly, keeps working through its own direct routes whether or
not it's in the S&P 500. This mirrors exactly how `/market/universe`
already works today (it's a *browse/search* helper, not a gate on
anything else) — this unit only narrows what that one browse/search
helper surfaces.

## A required, scoped fix to an existing test

`tests/test_p7a_trader_journey.py`'s
`test_full_trader_journey_search_to_portfolio` and
`test_journey_partial_fill_rejection_and_duplicate_resubmission` each
seed a fictional symbol (`"JRNY"`, `"JRN2"`) and then call
`GET /market/universe?search=...` expecting to find it. Neither
fictional ticker is in the real S&P 500 list, so after this unit's
change, that specific assertion in each test would start failing — not
because of a regression in the journey itself, but because the test's
own fixture symbol is no longer discoverable through the now-narrowed
search, exactly as designed.

**Required, in-scope fix:** rename the seeded symbol in both tests from
`"JRNY"` to `"SNA"` (Snap-on Incorporated, a real S&P 500 ticker) and
from `"JRN2"` to `"NDSN"` (Nordson Corporation, a real S&P 500 ticker) —
both confirmed absent from every other test file in this repository (no
collision risk), both already present in `app/data/sp500_constituents.csv`.
Every other seeded field (company name can stay whatever placeholder
string the test already used, prices, dates, quantities, assertions)
stays exactly as it is — only the ticker symbol string changes, in both
test functions, everywhere it's used as a seed value, a request
parameter, or an assertion target in those two tests. Do not touch any
other test file.

## New test file

`tests/test_p9a_universe_sp500.py`:

1. Seed one `MarketSymbol` with a ticker that **is** in the S&P 500 list
   (e.g. `"MMM"`, confirmed present) and one with a ticker that is
   **not** (e.g. `"ZZZFAKE"` or similar, confirmed absent from
   `app/data/sp500_constituents.csv` — check before using it, don't
   assume). Both `is_active=True`. Call `GET /market/universe` with no
   search term; assert the S&P 500 ticker appears in `items` and the
   non-member ticker does not.
2. Call `GET /market/universe?search=ZZZFAKE` (or whatever the
   non-member ticker from case 1 is); assert it returns zero items —
   confirming the narrowing applies even when searching by exact ticker,
   not only to the unfiltered browse case.
3. Confirm the non-member symbol from case 1 is still fully usable
   through its own direct route: seed a `MarketBarDaily` row for it and
   call `GET /market/symbols/{symbol}/history`; assert `200` and that
   the bar is returned — proving Stage 2's "held position outside the
   set stays readable" requirement without needing portfolio/holdings
   machinery in this test, since the history route itself never
   depended on `/universe` or S&P membership.

## What this does not do

Does not add any `is_sp500_member` column to `MarketSymbol`, does not
change `nasdaq_universe_service.py`'s sync behavior (it keeps syncing
the broad Nasdaq/NYSE directory exactly as before — this unit only
changes what one read endpoint surfaces from that already-synced data).
Does not touch the ETF/index display work in `market_overview` — already
adequate, per the note above.
