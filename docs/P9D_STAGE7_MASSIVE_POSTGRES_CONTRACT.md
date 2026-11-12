# Current delivery sequence, Stage 7 — Massive ingestion proof on real PostgreSQL

Roadmap: [Sentinel_Markets_2_0_Roadmap.md, Stage 7](../Sentinel_Markets_2_0_Roadmap.md#7-operational-verification),
step 1: "extending the disposable-Postgres proofs already done ... to the
new Massive/LSE/Kronos code paths." This extends them to Massive.

`tests/test_massive_ingestion.py` (already shipped, PR #99) only ever
ran against the SQLite fixture every other unit test uses. SQLite's own
`CheckConstraint` enforcement is looser and its typing more permissive
than real PostgreSQL's — this unit proves the same ingestion logic
against a real disposable PostgreSQL 17 instance, matching the existing
pattern in `tests/test_audit_postgres.py` (direct `create_engine`,
`pytest.mark.skipif(not os.environ.get("AUDIT_DATABASE_URL"), ...)`, not
the shared SQLite `db_session` fixture).

## New test file

`tests/test_massive_ingestion_postgres.py`, following
`tests/test_audit_postgres.py`'s exact structure (read that file first
for the precise `skipif` marker, engine construction, and
session-per-test pattern before writing this — do not invent a
different Postgres test harness):

1. Run `python -m alembic upgrade head` against `AUDIT_DATABASE_URL`
   first (matching `test_audit_postgres.py`'s own
   `test_migrations_and_app_role_grants_on_disposable_postgres` setup
   pattern — read it for the exact invocation), so the real
   `MarketBarDaily` table and its real `CheckConstraint`s exist.
2. Seed a `MarketSymbol` and call `ingest_one_day` (imported from
   `app.services.massive_ingestion`) with a mocked `http_get` (the same
   kind of fake callable `tests/test_massive_ingestion.py` already
   uses — reuse that file's `_grouped`/`_ticker`/`_http_get` helper
   functions by importing them, don't duplicate them) for 3 valid
   symbols. Assert the report matches (`written_valid: 3`), and that
   the real PostgreSQL table actually contains 3 rows with real
   `CheckConstraint`-enforced columns — reread them directly via the
   test's own engine, not through the app's ORM session, to prove the
   data genuinely persisted and satisfies the real constraints (not
   just that the Python-level `_fails_table_checks` guard agreed with
   itself).
3. Call `ingest_one_day` a **second** time with the identical payload
   and day: assert the row count is still 3 (the upsert updates in
   place, it does not insert duplicates) — this is the same idempotency
   property `tests/test_massive_ingestion.py`'s first test already
   checks against SQLite; this case confirms it holds against real
   PostgreSQL's own primary-key enforcement too, not just SQLite's.
4. Call `ingest_one_day` with a payload containing a bar that
   `_fails_table_checks` would catch (e.g. inverted OHLC) mixed with
   otherwise-valid bars: assert the invalid one is reported in
   `rejected` and never reaches an `INSERT` at all (confirm by row
   count — the valid bars' rows exist, the rejected symbol's does not),
   proving the app-level guard correctly prevents ever triggering a
   real constraint violation against Postgres (a failed constraint
   would abort the whole transaction, which is exactly why
   `_fails_table_checks` exists — this test proves that guard actually
   does its job for real, not just in SQLite).
5. Clean up: the disposable database used for this test run should be
   left in the same state `test_audit_postgres.py` leaves things (it
   doesn't drop its own schema — check what that file actually does at
   teardown, if anything, and match it; don't invent new teardown
   behavior).

## What this does not do

Does not test real concurrent/overlapping ingestion calls racing on the
same symbol/day (a real, theoretical gap — `_upsert_daily_bar` has no
row lock and no unique-constraint-conflict handling, so two genuinely
simultaneous calls for the same key could race) — that is a separate,
larger concurrency-test unit, not attempted here, since nothing wires
`ingest_one_day` to ever run concurrently with itself today (no
scheduler wiring exists yet, per Stage 3's own disclosed scope). Flag
this as a known, undemonstrated gap in the verification doc rather than
silently claiming concurrency safety this unit never tested.
