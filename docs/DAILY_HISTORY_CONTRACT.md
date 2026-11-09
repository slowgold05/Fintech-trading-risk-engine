# Canonical daily research history

P1-B local schema decision, 2026-11-05. Raw and separately labeled split-adjusted research series are supported. This provisional choice does not approve a provider, authorize collection or public display, or claim that a series has been backfilled.

## Identity and provenance

`market_bars_daily` is a daily-only table. Its primary key is `(symbol, session_date, provider, adjustment_type)`. The interval is implicitly `1d`; intraday data needs a separate reviewed contract. `session_date` is the provider's exchange session date, not a fabricated midnight observation timestamp. The symbol references the canonical symbol table.

Provider and adjustment type are required parts of identity. Two providers, or raw and adjusted prices, cannot overwrite one another under the same key. Read and ingestion paths must select one explicit provider and adjustment series; they must not combine whichever rows happen to exist into a continuous-looking curve.

`adjustment_type` is `raw` or `split_adjusted`. The latter is a research series, not a total-return series and never an execution reference. OHLC and volume are provider-reported for that named series. Split-adjusted volume conventions must be documented by the selected provider before ingestion; this schema does not invent an adjustment transform. No provider has been selected or entitled by P1-B.

OHLC uses `Numeric(18,6)`. Prices must be finite, positive, and inside that numeric range; open and close must lie between low and high. Volume is a nonnegative integer. `fetched_at` is required and has no automatic default: ingestion supplies its actual UTC fetch time, independently of session date. PostgreSQL stores a timezone-aware timestamp; SQLite does not retain timezone metadata, so writers must normalize UTC before storage. The ingestion boundary must reject naive or otherwise invalid input times.

`quality_status` is explicitly supplied as `valid`, `flagged`, or `rejected`. Structural errors cannot enter the table. A coherent bar may still be flagged or rejected for data-quality reasons such as jumps or source disagreement. Downstream quantitative reads must use eligible quality states explicitly; storing a bar is not a declaration that it is fit for risk math.

## Legacy and rollout boundaries

Revision `a21c9e7d4b60`, after `f3a8c2d7e961`, adds only this table. It copies no rows from `price_history_daily`. Legacy rows lack adjustment and fetch-time provenance, so their semantics must not be guessed. The old table and current refresh path remain intact until a separately reviewed ingestion change. The new table starts empty.

The grant script gives the application its existing data-cache permissions on the new table. User-role and ledger restrictions stay in force. Run the migration and matching grant script only on the isolated rehearsal instance first. The role password is cluster-wide.

There is no new provider call, backfill, scheduler change, history endpoint, frontend chart, or deployment in P1-B. Empty canonical history must remain unavailable to consumers. A future rollback drops the canonical table and its contents; once production data is ingested, export or preserve that data before any downgrade.
