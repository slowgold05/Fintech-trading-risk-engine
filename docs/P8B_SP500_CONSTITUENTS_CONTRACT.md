# Current delivery sequence, Stage 1 step 3 — S&P 500 constituent data file

Roadmap: [Sentinel_Markets_2_0_Roadmap.md, Stage 1](../Sentinel_Markets_2_0_Roadmap.md#1-baseline-and-permissions).
Source evidence: [docs/sp500_constituents_2026-11-11.md](sp500_constituents_2026-11-11.md)
(503 rows, verbatim from Wikipedia revision `oldid=1384572480`, five
spot-checked entries confirmed real).

**Scope boundary:** this unit only transcribes the already-sourced list
into a validated, machine-readable file and a tiny loader. It does **not**
wire anything into `MarketSymbol`, `nasdaq_universe_service.py`, or any
discovery/API route — that is Stage 2's job, which has its own
prerequisite on this file existing and passing its own tests first. Do
not touch `app/routers/market.py` or any existing service in this unit.

## What to build

1. **`app/data/sp500_constituents.csv`** (new directory, new file) — one
   row per company, columns exactly: `ticker,security,gics_sector,gics_sub_industry`.
   Transcribe **every single row** from the "Full list" code block in
   [docs/sp500_constituents_2026-11-11.md](sp500_constituents_2026-11-11.md)
   exactly as written there — do not reformat company names, do not
   "clean up" GICS sector/sub-industry text, do not drop or merge any row
   (including the dual-class rows: `GOOGL`/`GOOG`, `BRK.B`, `NWSA`/`NWS`,
   `FOXA`/`FOX`, and the `HON`/`HONA` pair). The source file already notes
   503 total rows. CSV quoting: wrap any field containing a comma (e.g.
   `"Coca-Cola Company (The)"` has no comma, but check each field
   carefully) in double quotes per standard CSV rules.
2. **`app/services/sp500_constituents.py`** — one function,
   `load_sp500_constituents() -> list[dict]`, reading the CSV above
   (path relative to this module's own file, via `pathlib.Path(__file__)`,
   not a hardcoded absolute path) and returning a list of dicts with keys
   `ticker`, `security`, `gics_sector`, `gics_sub_industry`. Use the
   stdlib `csv` module (`csv.DictReader`), not a new dependency. No
   caching, no database write, no network call — this is a pure,
   synchronous, file-backed reader.
3. **`app/data/index_benchmarks.csv`** — exactly four rows, columns
   `name,description`: `S&P 500`, `Nasdaq Composite`, `Dow Jones Industrial Average`,
   `Russell 2000` (same four named in the source evidence doc). No price
   or level data — this file only records which four benchmarks are
   designated, not their current values (a live-data question for a
   later stage).
4. **`app/services/index_benchmarks.py`** — mirrors
   `sp500_constituents.py`'s pattern: `load_index_benchmarks() -> list[dict]`
   with keys `name`, `description`.

## Tests

New file `tests/test_sp500_constituents.py`:

1. `load_sp500_constituents()` returns exactly 503 rows.
2. No duplicate `ticker` values (every ticker appears exactly once, even
   across the dual-class pairs — `GOOGL` and `GOOG` are two distinct
   tickers, not a duplicate of each other).
3. Every row has all four fields non-empty.
4. A handful of spot-check assertions for specific rows, e.g.
   `{"ticker": "AAPL", "security": "Apple Inc.", ...}` and
   `{"ticker": "HONA", "security": "Honeywell Aerospace", ...}` are both
   present — confirms the transcription didn't silently drop the newer
   entries.
5. `load_index_benchmarks()` returns exactly 4 rows with the exact four
   names listed above, in any order.

## What this does not do

Does not change any existing route, model, or test. Does not affect
`GET /market/universe` or any other existing endpoint — this data is not
yet consumed anywhere. Stage 2 (a separate, later unit) is responsible
for actually using this loader to narrow discovery.
