# Canonical daily research history

P1-B local schema decision, 2026-11-05. Raw and separately labeled split-adjusted research series are supported. This provisional choice does not approve a provider, authorize collection or public display, or claim that a series has been backfilled.

## Identity and provenance

`market_bars_daily` is a daily-only table. Its primary key is `(symbol, session_date, provider, adjustment_type)`. The interval is implicitly `1d`; intraday data needs a separate reviewed contract. `session_date` is the provider's exchange session date, not a fabricated midnight observation timestamp. The symbol references the canonical symbol table.

Provider and adjustment type are required parts of identity. Two providers, or raw and adjusted prices, cannot overwrite one another under the same key. Read and ingestion paths must select one explicit provider and adjustment series; they must not combine whichever rows happen to exist into a continuous-looking curve.

`adjustment_type` is `raw` or `split_adjusted`. The latter is a research series, not a total-return series and never an execution reference. OHLC and volume are provider-reported for that named series. Massive's grouped daily endpoint confirms the requested split adjustment in its `adjusted` response field; its aggregate volume can be fractional. Neither series is dividend-adjusted. An adjusted backfill stores a separate series and never relabels raw bars.

After the fractional-volume migration is applied, `python -m app.scripts.backfill_massive_history --adjustment split_adjusted` fills missing adjusted sessions and resumes by skipping stored sessions. Run it only as a coordinated historical job so it does not compete with scheduled Massive calls. After a split changes the basis of older adjusted prices, `python -m app.scripts.backfill_massive_history --adjustment split_adjusted --refresh-adjusted` re-fetches the two-year adjusted window and commits it atomically; any failed or incomplete session rolls it back. This full-window refresh is paced and can take roughly two hours on Stocks Basic. Raw bars and quotes are never rewritten by either command.

OHLC uses `Numeric(18,6)`. Prices must be finite, positive, and inside that numeric range; open and close must lie between low and high. Volume is a nonnegative integer. `fetched_at` is required and has no automatic default: ingestion supplies its actual UTC fetch time, independently of session date. PostgreSQL stores a timezone-aware timestamp; SQLite does not retain timezone metadata, so writers must normalize UTC before storage. The ingestion boundary must reject naive or otherwise invalid input times.

`quality_status` is explicitly supplied as `valid`, `flagged`, or `rejected`. Structural errors cannot enter the table. A coherent bar may still be flagged or rejected for data-quality reasons such as jumps or source disagreement. Downstream quantitative reads must use eligible quality states explicitly; storing a bar is not a declaration that it is fit for risk math.

## Legacy and rollout boundaries

Revision `a21c9e7d4b60`, after `f3a8c2d7e961`, adds only this table. It copies no rows from `price_history_daily`. Legacy rows lack adjustment and fetch-time provenance, so their semantics must not be guessed. The old table and current refresh path remain intact until a separately reviewed ingestion change. The new table starts empty.

The grant script gives the application its existing data-cache permissions on the new table. User-role and ledger restrictions stay in force. Run the migration and matching grant script only on the isolated rehearsal instance first. The role password is cluster-wide.

There is no new provider call, backfill, scheduler change, history endpoint, frontend chart, or deployment in P1-B. Empty canonical history must remain unavailable to consumers. A future rollback drops the canonical table and its contents; once production data is ingested, export or preserve that data before any downgrade.
