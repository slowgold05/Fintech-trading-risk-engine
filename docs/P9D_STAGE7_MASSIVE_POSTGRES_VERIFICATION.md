# Current delivery sequence, Stage 7 — Massive ingestion on real PostgreSQL, verification

Contract: [P9D_STAGE7_MASSIVE_POSTGRES_CONTRACT.md](P9D_STAGE7_MASSIVE_POSTGRES_CONTRACT.md).

## Diff scope

One new file, `tests/test_massive_ingestion_postgres.py`. No other file
touched, confirmed via `git status`.

## Logic review

- Matches `tests/test_audit_postgres.py`'s exact structure: module-level
  `pytest.mark.skipif(not os.environ.get("AUDIT_DATABASE_URL"), ...)`,
  `create_engine(..., poolclass=NullPool, future=True)`, Alembic's
  `command.upgrade` called in-process (not a subprocess) — confirmed by
  reading both files side by side.
- Uses a random per-run symbol suffix (`uuid4().hex[:8]`) so repeated
  runs against the same disposable database never collide on
  `market_symbols` — correctly recognized that this file, like
  `test_audit_postgres.py`, does not drop its own schema between runs.
- Test 1 confirms the real `pg_constraint` catalog has all six expected
  `CheckConstraint` names on `market_bars_daily` — a genuine proof that
  the real table, not just the SQLAlchemy model definition, enforces
  these.
- Tests 2–4 read committed rows back through a **separate** raw
  connection (`_stored_bars`, plain `text()` SQL), not the ingestion
  session's own ORM objects — a real proof of persistence and real
  constraint-satisfying values, not just that the Python code agrees
  with itself.
- Test 4 (inverted OHLC) confirms `_fails_table_checks` keeps a bad bar
  from ever reaching an `INSERT` against the real database — exactly
  the scenario the contract asked to prove, since a real constraint
  violation would abort the whole transaction.

## Test verification

Independently ran against a freshly created disposable `postgres:17`
container (never the user's own dev container), `AUDIT_DATABASE_URL`
pointed at it:

- `tests/test_massive_ingestion_postgres.py` alone: **5 passed.**
- Full backend suite with `AUDIT_DATABASE_URL` set: **584 passed, 7
  skipped, zero failures.**
- Full backend suite with `AUDIT_DATABASE_URL` unset (pure SQLite),
  first run: `1 failed, 546 passed, 44 skipped` — the failure,
  `tests/test_portfolio_valuation.py::test_portfolio_clock_sample_keeps_the_prewrite_quote`,
  is in a file this unit never touched, and is the same family of
  Windows clock-sampling timing flake already documented repeatedly
  elsewhere in this project (a different specific test than previous
  occurrences, same root cause category). Isolated rerun: passed. Full
  suite rerun with a fresh `--basetemp`: **547 passed, 44 skipped, zero
  failures.**
- Disposable container destroyed immediately after.

## What this does not prove, disclosed per the contract

Does not test two genuinely concurrent `ingest_one_day` calls racing on
the same symbol/day — `_upsert_daily_bar` takes no row lock and has no
unique-constraint-conflict handling. This is a real, undemonstrated gap,
not claimed as safe here, and not currently reachable in practice since
nothing in the app runs this function concurrently with itself yet (no
scheduler wiring exists for it — Stage 3's own disclosed scope).
