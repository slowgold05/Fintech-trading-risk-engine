# SEC EDGAR filings index verification

First unit of roadmap Phase 5 (AI Research Desk) — a standalone SEC EDGAR filings-index
data source, distinct from the already-shipped XBRL fundamentals
(`get_sec_company_fundamentals`). Design written first as
`docs/P5A_SEC_FILINGS_CONTRACT.md`.

## Implemented by Grok, independently verified by me

- `app/services/sec_service.py`: new `get_sec_company_filings(symbol, db, forms, limit)`,
  reusing the existing `_get_ticker_map()`/`_headers()` helpers — `get_sec_company_fundamentals`
  is byte-identical to before this change.
- `app/models/market_filings_cache.py`: new model, mirroring
  `app/models/market_fundamentals_cache.py`'s shape exactly.
- `alembic/versions/<new>_add_market_filings_cache.py`: new migration adding
  `market_filings_cache`, chained onto head `b73e2d9f6a10`.
- `app/routers/research.py`: new file, `GET /research/filings/{symbol}` — the first route
  under this prefix.
- `app/main.py`: one new `app.include_router(research.router, prefix="/research",
  tags=["Research"])` line.
- `tests/test_sec_filings.py`: new file.

## Independent verification

- Re-derived all four reference vectors in a standalone script before review (parallel
  SEC `filings.recent` arrays zipped, default-forms filter, descending sort by
  `filingDate`/`accessionNumber`, `document_url` built from the unpadded `int(cik)` and
  dash-stripped accession number). All four matched the contract exactly:
  - Reference 1 (default forms, `limit=10`): 4 entries, `DEF 14A` excluded, newest
    (`2026-08-01`, 10-Q) first.
  - Reference 2 (`limit=2`): the same list's first two entries only.
  - Reference 3 (`forms=["10-K"]`): exactly the one `10-K`, proving an explicit `forms`
    list replaces the default rather than adding to it.
  - Reference 4 (`forms=["20-F"]`, no matches in the fixture): `filings: []`, not an
    error.
- Reviewed the full diff of every touched/new file directly (not Grok's self-report).
- Confirmed `requests.get` is never called when a fresh (<24h) cache row exists — same
  `monkeypatch.setattr("requests.get", boom)` pattern already used for
  `get_sec_company_fundamentals` in `tests/test_market_history.py`.
- `python -m pytest -q tests/test_sec_filings.py`: **7 passed** (all new).
- `python -m pytest -q` (full backend suite): **415 passed, 28 skipped**, plus the same 2
  pre-existing unrelated Windows-local SQLite-locking errors documented since PR #27 (not
  new — confirmed by reading the actual failure, a `PermissionError` on a pytest temp dir,
  unrelated to this change).
- Confirmed `app/services/sec_service.py`'s existing `get_sec_company_fundamentals`,
  `_get_ticker_map`, `_headers` are unchanged in behavior (same inputs/outputs as before),
  and `GET /market/research/{symbol}` is untouched.
- `python -m alembic heads` resolves to exactly one head (the new revision,
  `e1a7c3b5d820`, chained onto the prior head `b73e2d9f6a10`) — confirms no branch split.
  Did **not** run `alembic upgrade head` against a live database: this sandbox has no
  reachable Postgres instance (the command hung waiting for a connection); the same
  boundary applies to every prior migration shipped this session, since tests exercise
  the schema via `Base.metadata.create_all`, not a live Alembic run. The migration's
  `upgrade()`/`downgrade()` bodies were reviewed directly against
  `7e9d4c1a2b30_add_market_data_cache.py`'s own `market_fundamentals_cache` block and are
  structurally identical (same column types, same two indexes, same drop order).

## What this unit does not do

No job queue, no worker, no TradingAgents integration, no report synthesis, none of the
other Phase 5 API surface (`/research/jobs`, `/research/reports`, `/research/briefs`).
No frontend. Does not change `get_sec_company_fundamentals`, `market_fundamentals_cache`,
or the existing `GET /market/research/{symbol}` route.
