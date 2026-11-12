# Current delivery sequence, Stage 2 — focused market universe, verification

Contract: [P9A_STAGE2_UNIVERSE_CONTRACT.md](P9A_STAGE2_UNIVERSE_CONTRACT.md).

## Diff scope

`app/routers/market.py`, `tests/test_p7a_trader_journey.py`, and the new
`tests/test_p9a_universe_sp500.py` — exactly the files granted. No other
file touched (the pre-existing, unrelated uncommitted changes to
`docs/REVIEW_2026-11-09.md`/`docs/aws_deployment.md`/`readme.md` from
earlier in this session are untouched by this unit).

## Logic review

- `market_universe` now loads `load_sp500_constituents()` once per
  request, builds a plain `set` of tickers, and adds
  `MarketSymbol.symbol.in_(sp500_tickers)` alongside the existing
  `is_active` filter and search-term logic — confirmed by reading the
  diff directly, matches the contract exactly. `market_overview`,
  `INDEX_SYMBOLS`, and `SECTOR_SYMBOLS` are untouched.
- `tests/test_p7a_trader_journey.py`: every `"JRNY"`/`"JRN2"` string
  renamed to `"SNA"`/`"NDSN"` respectively (confirmed zero remaining
  occurrences of the old strings), nothing else in the file changed.
- `tests/test_p9a_universe_sp500.py` covers the three contract cases
  exactly: unfiltered browse includes the real member and excludes the
  outsider; an exact-ticker search for the outsider returns zero items;
  the outsider's own `/market/symbols/{symbol}/history` route still
  works, unaffected by universe narrowing — confirming Stage 2's "held
  position outside the set stays readable" requirement without needing
  portfolio/holdings machinery.
- Confirmed no frontend code references `/market/universe` or
  "universe" anywhere today — no frontend impact to verify for this
  backend-only change.

## Test verification

Independently reran (not trusting the self-report alone), fresh
`--basetemp` each time, `AUDIT_DATABASE_URL` unset:

- `tests/test_p7a_trader_journey.py` + `tests/test_p9a_universe_sp500.py`:
  **5 passed**.
- Full backend suite: **538 passed, 39 skipped, zero failures.**

## What this does not do

Does not change `nasdaq_universe_service.py`'s sync behavior (still
syncs the full Nasdaq/NYSE directory) or add any `is_sp500_member`
column — this is a read-time filter on one endpoint only, not a schema
or ingestion change. Does not touch the existing ETF/index display in
`market_overview`, already adequate per the contract's own note (though
a "Nasdaq 100" vs "Nasdaq Composite" naming mismatch between that
existing code and the roadmap's own Stage 1 benchmark list remains
flagged, not resolved, in either this unit or the contract).
