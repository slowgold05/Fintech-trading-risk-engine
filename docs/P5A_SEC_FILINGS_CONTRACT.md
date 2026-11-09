# SEC EDGAR filings index contract

Roadmap Phase 5 (AI Research Desk) names "SEC fundamentals/filings" as one of several
data sources the eventual research worker calls (section 5.2). SEC *fundamentals* (XBRL
company facts: revenue, net income, assets, liabilities, equity, EPS) already ship via
`get_sec_company_fundamentals` (`app/services/sec_service.py`), feeding `GET
/market/research/{symbol}`. That is **not** this unit.

What is still missing, and what this unit adds, is the **filings index** — a company's
recent 10-K/10-Q/8-K filings (form, dates, accession number, a direct document link) — a
distinct SEC EDGAR data source (the `submissions/CIK{cik}.json` endpoint, not the XBRL
`companyfacts` endpoint `get_sec_company_fundamentals` already calls). This is pure
data-source groundwork: no job queue, no worker, no report synthesis. Those stay out of
scope for this unit.

## New function: `get_sec_company_filings` (`app/services/sec_service.py`)

```python
def get_sec_company_filings(
    symbol: str,
    db: Session,
    forms: list[str] | None = None,
    limit: int = 10,
) -> dict:
```

- Resolves `symbol` → CIK the same way `get_sec_company_fundamentals` already does: reuses
  the existing `_get_ticker_map()` / `_headers()` helpers. `symbol` not found in the SEC
  ticker map → raises `ValueError` (same contract `get_sec_company_fundamentals` already
  has — callers already know how to handle this).
- Cache: a new table, `market_filings_cache` (`symbol` PK, `cik`, `payload` JSON, `source`,
  `fetched_at`), mirroring `market_fundamentals_cache`'s own shape and 24-hour freshness
  cutoff exactly (`fetched_at >= now - 24h` → return cached `payload` with no live call).
  **The cached `payload` is the full, unfiltered, unlimited list of filings** (every form,
  every entry SEC returns under `filings.recent`) plus `name` and `cik` — `forms`/`limit`
  are request-time parameters applied on every call (cached or not), never baked into the
  cached payload, since two different calls for the same symbol may want different
  forms/limit.
- Live fetch (cache miss or stale): `GET https://data.sec.gov/submissions/CIK{cik}.json`
  with the same `_headers()`. SEC returns `filings.recent` as **parallel arrays** —
  `form[i]`, `filingDate[i]`, `reportDate[i]`, `accessionNumber[i]`, `primaryDocument[i]`
  all describe entry `i`. Zip them into one list of dicts before caching (never keep the
  parallel-array shape past parsing — every consumer wants one filing per dict).
- Default `forms` (when the caller passes `None`): `["10-K", "10-Q", "8-K"]` — the three
  types the roadmap itself names. Passing an explicit `forms` list overrides this entirely
  (does not add to the default). An entry whose `form` is not in the effective `forms` list
  is **excluded**, not just deprioritized.
- Sort the filtered list by `filingDate` **descending**, tie-broken by `accessionNumber`
  descending (newest filings first — accession numbers are chronological, so this orders
  same-day filings deterministically). Then take the first `limit` entries.
- `document_url` is **computed at read time**, not cached as a field, from `cik` and each
  filing's own `accessionNumber`/`primaryDocument`:
  `f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{primary_document}"`
  (`int(cik)` strips the zero-padding SEC's CIK uses internally — EDGAR's own document URLs
  use the unpadded numeric CIK in the path).
- Returns:
  ```python
  {
      "symbol": "ACME",
      "cik": "0000123456",
      "name": "<entity name from SEC>",
      "filings": [
          {
              "form": "10-Q",
              "filing_date": "2026-08-01",
              "report_date": "2026-06-30",
              "accession_number": "0000123456-26-000090",
              "primary_document": "acme-20260630.htm",
              "document_url": "https://www.sec.gov/Archives/edgar/data/123456/000012345626000090/acme-20260630.htm",
          },
          # ... newest first, up to `limit` entries, forms outside the effective filter excluded
      ],
      "source": "SEC EDGAR",
      "fetched_at": "2026-11-08T00:00:00Z",  # from the cache row's fetched_at, via a local _iso_z helper
  }
  ```
  A company with zero filings matching the effective `forms` filter returns `filings: []`
  — this is a normal result, not an error.

## New route: `GET /research/filings/{symbol}` (new `app/routers/research.py`, new
`/research`-prefixed router mounted in `app/main.py`)

- The **first route under `/research`** — lays the prefix the roadmap's own Phase 5 API
  list (5.4: `/research/jobs`, `/research/reports`, `/research/briefs`) will keep using.
  Does not collide with the existing, unrelated `GET /market/research/{symbol}` (a
  different, already-shipped company-research summary route under `/market`).
- Query params: `forms` (optional, comma-separated, e.g. `?forms=10-K,8-K`; omitted →
  service default `["10-K","10-Q","8-K"]`), `limit` (optional int, default 10, rejected
  with `422` outside `1..50`).
- Requires auth (`Depends(get_current_user)`, same as every other router in this app) —
  this is read-only, does not touch the caller's own book, but every other route in this
  app requires a signed-in user and this one follows that same baseline.
- `ValueError` (symbol not found in SEC's ticker map) → `404` with the exception's own
  message as `detail`.
- `requests.RequestException` (live SEC call failed, no usable cache) → `503`, generic
  `detail` (do not leak the raw exception text — same reason other routes in this app
  don't: it may contain the outbound URL).

## Migration

A new Alembic revision adding `market_filings_cache`, chained onto the current head
(`b73e2d9f6a10`), mirroring `7e9d4c1a2b30`'s own `market_fundamentals_cache` table exactly
(same column types, same two indexes — `cik` and `fetched_at`).

## Reference vectors (hand-built, not live SEC data — verified independently before
implementation)

Symbol `ACME`, CIK `0000123456`. Raw `filings.recent` (5 entries, deliberately unsorted
and including one form outside the default filter):

| # | form     | filingDate | reportDate | accessionNumber         | primaryDocument        |
|---|----------|------------|------------|--------------------------|-------------------------|
| 1 | 10-Q     | 2026-05-01 | 2026-03-31 | 0000123456-26-000050     | acme-20260331.htm      |
| 2 | 10-K     | 2026-02-15 | 2025-12-31 | 0000123456-26-000010     | acme-20251231.htm      |
| 3 | 8-K      | 2026-06-10 | (empty)    | 0000123456-26-000070     | acme-8k-20260610.htm   |
| 4 | DEF 14A  | 2026-04-01 | (empty)    | 0000123456-26-000040     | acme-defproxy.htm      |
| 5 | 10-Q     | 2026-08-01 | 2026-06-30 | 0000123456-26-000090     | acme-20260630.htm      |

**Reference 1 — default forms, default limit** (`forms=None`, `limit=10`): excludes #4
(`DEF 14A` not in `{10-K,10-Q,8-K}`), keeps 4 entries, sorted newest-`filingDate`-first:

```
#5 (10-Q, 2026-08-01) → document_url = https://www.sec.gov/Archives/edgar/data/123456/000012345626000090/acme-20260630.htm
#3 (8-K,  2026-06-10) → document_url = https://www.sec.gov/Archives/edgar/data/123456/000012345626000070/acme-8k-20260610.htm
#1 (10-Q, 2026-05-01) → document_url = https://www.sec.gov/Archives/edgar/data/123456/000012345626000050/acme-20260331.htm
#2 (10-K, 2026-02-15) → document_url = https://www.sec.gov/Archives/edgar/data/123456/000012345626000010/acme-20251231.htm
```

**Reference 2 — `limit=2`** (same default forms): only the first two of Reference 1's
list — `#5` then `#3`.

**Reference 3 — explicit `forms=["10-K"]`**: only `#2` (the only `10-K`); confirms an
explicit `forms` list *replaces* the default rather than extending it (if it extended the
default, `#4`/DEF 14A would still be excluded here regardless, but a wrongly-additive
implementation would also wrongly include the default `10-Q`/`8-K` entries alongside the
requested `10-K` — this reference vector is exactly what catches that bug).

**Reference 4 — no filings match**: `forms=["DEF 14A"]` on this same fixture (note: the
raw data DOES have one `DEF 14A`, so this would return `#4` — to actually test the
genuine zero-match case, use `forms=["20-F"]`, which does not appear in the fixture at
all) → `filings: []`, `200`, not an error.

## What this unit does not do

No job queue, no worker, no TradingAgents integration, no report synthesis, no `POST
/research/jobs` or any of the other Phase 5 API surface named in roadmap section 5.4 —
this is one data-source building block those will eventually call. No frontend. Does not
touch `get_sec_company_fundamentals`, `market_fundamentals_cache`, or `GET
/market/research/{symbol}` — all byte-identical after this change.
