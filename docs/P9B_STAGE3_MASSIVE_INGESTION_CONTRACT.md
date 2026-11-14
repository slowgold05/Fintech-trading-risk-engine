# Current delivery sequence, Stage 3, first slice — real Massive ingestion writer

Roadmap: [Sentinel_Markets_2_0_Roadmap.md, Stage 3](../Sentinel_Markets_2_0_Roadmap.md#3-multi-source-historical-and-quote-data-pipeline).

**Scope boundary, read first:** this slice covers Massive only (step 1
of Stage 3). LSE (step 2) is **not** attempted here — Stage 1's own
vendor review ([grc/vendors/lse.md](lse.md)) found LSEG has no simple
self-serve API with a known response shape; building an "LSE adapter"
without real documentation to work from would mean guessing at a
payload format, which this contract explicitly refuses to do. LSE stays
a separate, later unit once a real access path and its actual response
shape are known.

**No real Massive API key exists in this environment** (`massive_api_key`
defaults to `""`). This unit builds and unit-tests real, callable
ingestion code — never fixture-only stubs — but **cannot and does not
run it against the live Massive API**, exactly the same disclosed
boundary as every Kronos/TradingAgents unit this session that needed
real external weights or packages it didn't have. State this plainly in
the verification doc; do not claim a live run happened.

## What already exists, reused as-is (do not modify these files)

- `app/services/market_providers.py`'s `fetch_massive_grouped(day, api_key, http_get)`
  and `parse_massive_grouped(payload, day)` — already parse Massive's
  real grouped-daily response shape (`{"status": "OK", "results": [{"T":...,"o":...,"h":...,"l":...,"c":...,"v":...}]}`)
  into `Bar` objects. Call these directly; do not reimplement parsing.
- `app/services/market_quality.py`'s `check_bars(bars, *, symbols, as_of, peers=None, ...)` —
  already does non-positive/inverted-price, staleness, single-day-jump,
  and cross-source-disagreement checks, returning a list of finding
  dicts with a `symbol` key. Reuse this for every batch of fetched bars
  before writing anything.
- `app/services/exchange_calendar.py`'s `expected_session_dates(start, end)` —
  already enumerates real NYSE trading sessions between two dates. Use
  this to build the list of days to fetch for a 2-year backfill, and to
  compute which expected sessions are missing afterward (gap detection —
  do not write new gap-detection logic, derive it from the difference
  between this function's output and what was actually written).

## New: a real HTTP client for Massive

`app/services/massive_client.py` — one function,
`http_get_massive(kind: str, arg, api_key: str) -> dict`, matching the
`http_get` callable signature `fetch_massive_grouped` already expects
(`http_get(provider_name, arg, api_key)`). For `kind == "massive"`
(the only kind this fetch function ever passes), `arg` is a `date`.
Build the real request: `GET https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/{YYYY-MM-DD}?apiKey={api_key}`
(Massive's actual documented grouped-daily endpoint path, inherited
from its Polygon.io lineage — this is the real, correct URL, not a
placeholder) using the stdlib `requests` library already used elsewhere
in this codebase (see `app/services/market_cache_service.py` or
`nasdaq_universe_service.py` for the existing `requests` usage pattern
and timeout convention — match it, don't invent a new one). Raise
`app.services.market_providers.ProviderUnavailable` on a non-2xx
response or a request exception, with the real status code or exception
class name in the message. Return the parsed JSON body on success.

## New: the ingestion writer

`app/services/massive_ingestion.py`:

```python
def ingest_one_day(db, day, symbols, api_key, http_get=http_get_massive) -> dict:
    ...
```

- Calls `fetch_massive_grouped(day, api_key, http_get)`.
- Filters the returned bars to only the symbols in `symbols` (a backfill
  call covers the entire market in one request; this app only wants the
  Stage 2 universe plus any symbol a user already holds — the caller
  supplies that list, this function does not decide it).
- Runs `check_bars` on the filtered bars (`symbols=[bar.symbol for bar in filtered]`,
  `as_of=day`).
- For each filtered bar: if its symbol has no finding from `check_bars`,
  upsert a `MarketBarDaily` row by its composite primary key
  (`symbol`, `session_date`, `provider`, `adjustment_type`) using the
  same check-then-create-or-update pattern already established in
  `app/services/market_cache_service.py`'s `_write_quote_cache`
  (query first by primary key; if found, update its fields in place;
  if not found, construct and `db.add` a new row) — do not use
  `session.merge`. Set `provider="massive"`,
  `adjustment_type="raw"`, `quality_status="valid"`, and
  `fetched_at=datetime.now(timezone.utc)` — **timezone-aware, do not
  strip tzinfo.** `MarketBarDaily.fetched_at` is a
  `DateTime(timezone=True)` column — checked directly: it is the
  *only* `timezone=True` column anywhere in `app/models/`, so there is
  no existing precedent elsewhere to copy. `market_providers.py`'s own
  `Bar.fetched_at` (built via its internal `_now()`, which strips
  tzinfo) and `market_cache_service.py`'s `MarketQuoteCache` writes
  (a plain, naive `DateTime` column) both use a different, naive
  convention — do not copy either of those for this specific write.
  When writing the `MarketBarDaily` row itself, use a fresh
  `datetime.now(timezone.utc)` directly (not `bar.fetched_at`, which is
  already naive from the `Bar` dataclass). If a symbol has a finding, write the row anyway but
  with `quality_status="flagged"` (matching the model's own allowed
  values: `valid`, `flagged`, `rejected`) — never silently drop a bar
  that came back from the provider, per Stage 3's own "a missing or
  rejected bar is reported as missing, never interpolated" rule (a
  flagged bar is visible, not silently discarded; a genuinely malformed
  row that fails the table's own `CheckConstraint`s, e.g. inverted
  OHLC, should be skipped with its symbol recorded in the returned
  report's own `rejected` list rather than attempting and catching a
  database constraint violation).
- Returns a dict: `{"day": day.isoformat(), "requested": len(symbols),
  "written_valid": n, "written_flagged": n, "rejected": [...symbols...],
  "missing": [...symbols requested but absent from the provider response...]}`.

```python
def backfill_two_years(db, symbols, api_key, *, http_get=http_get_massive, today=None) -> dict:
    ...
```

- Computes the session list via `expected_session_dates(start, today_or_given)`
  where `start` is computed with `market_history.py`'s own
  `two_calendar_years_before(day)` function (`day.replace(year=day.year - 2)`,
  with a 29 Feb → 28 Feb fallback) — import and call that function
  directly rather than approximating with `timedelta(days=730)`, so
  this matches the app's existing definition of "2 years" exactly
  rather than a slightly different one.
- Calls `ingest_one_day` once per session date, in order, accumulating
  each call's report.
- Returns a single coverage report: `{"sessions_attempted": n,
  "sessions_with_data": n, "symbols_fully_covered": [...], "symbols_with_gaps": {symbol: [missing day isoformats]}, "per_day": [...each ingest_one_day report...]}`.
  "Fully covered" means every expected session date has a `valid` or
  `flagged` row for that symbol; compute this from what's actually in
  the per-day reports, not by re-querying the database a second time.
- Does **not** implement real retry/backoff logic for a live rate limit
  in this slice — note in a comment that a real backfill run would need
  to respect Massive's actual rate limit (documented as roughly 5
  calls/minute on a free tier per
  [grc/vendors/massive.md](massive.md)) and that this function's current
  form calls `ingest_one_day` back-to-back with no delay, which is fine
  for the mocked tests below but would need a real pacing mechanism
  added before ever pointing it at the live API with a real key — that
  pacing mechanism is explicitly **not** built in this slice (no key
  exists to need it against yet; building untestable rate-limit code
  now would be premature).

## Tests

`tests/test_massive_ingestion.py`, using a fake `http_get` callable (no
real network call, matching the existing test style for
`fetch_finnhub_candles` if such tests already exist — check first):

1. `ingest_one_day` with a mocked `http_get` returning a valid grouped
   payload for 3 symbols, requesting those exact 3 symbols: writes 3
   `valid` `MarketBarDaily` rows, report shows `written_valid: 3`,
   `rejected: []`, `missing: []`.
2. Same mocked payload, but `symbols` includes one ticker not present in
   the response: report's `missing` list includes it; no row written
   for it; the other symbols still get written correctly.
3. A mocked payload where one symbol's bar would fail `check_bars` (e.g.
   a price jump beyond the limit, seeded via a pre-existing `valid` bar
   for that symbol the previous day with a very different close): that
   symbol's row is written with `quality_status="flagged"`, not
   `"valid"`, and not silently dropped.
4. `backfill_two_years` with a mocked `http_get` that returns a fixed
   payload for every call: confirm the number of `ingest_one_day` calls
   matches `expected_session_dates`'s own count for that window (mock
   `http_get`, do not mock `expected_session_dates` itself — use the
   real calendar function so this test also proves the day-count is
   correct), and the returned coverage report's `sessions_attempted`
   matches that count.
5. `http_get_massive` itself: use `monkeypatch.setattr("app.services.massive_client.requests.get", ...)` —
   the exact pattern already used in `tests/test_market_data_refresh.py`
   (e.g. `monkeypatch.setattr("app.services.price_service.requests.get", lambda *args, **kwargs: SimpleNamespace(...))`) —
   do not introduce `requests_mock` or any new HTTP-mocking dependency.
   Confirm the request URL contains the day and API key, and that a
   non-200 `status_code` on the mocked response raises
   `ProviderUnavailable`.

## What this does not do

Does not wire `backfill_two_years` into the scheduler
(`app/services/scheduled_jobs.py`) or any route — this slice is the
ingestion logic itself, built and tested, not yet scheduled to run
automatically. Does not touch LSE. Does not add real rate-limit pacing
(noted above). Does not run against the real Massive API (no key
configured in this environment) — every test in this unit uses a
mocked `http_get`.
