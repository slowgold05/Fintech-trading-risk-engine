# P1-B canonical daily history verification

Implemented locally on 2026-11-05, uncommitted, following [P1-A verification](P1A_VERIFICATION.md). The schema and series boundary are in [DAILY_HISTORY_CONTRACT.md](DAILY_HISTORY_CONTRACT.md). No roadmap phase is declared complete.

Revision `a21c9e7d4b60` follows `f3a8c2d7e961` and adds `market_bars_daily`. Symbol, exchange session date, provider and adjustment identify each daily bar. Raw and split-adjusted research series remain separate. Fetch timestamp and quality are explicit. Database constraints reject invalid OHLC, negative volume, unsupported labels and PostgreSQL numeric NaN. Legacy history is neither copied nor relabeled.

## Checks run

- `python -m pytest -q tests/test_market_bar_daily.py tests/test_browser_isolation.py --disable-warnings`: 17 passed.
- Complete backend suite on a fresh `p1a_audit_*` database inside the isolated PostgreSQL 17 proof container at loopback port 54329: 163 passed, 1 skipped, 587 warnings in 46.55 seconds. The skip is the Selenium module absent from Python 3.14; P1-A browser checks ran separately in Python 3.11. This run includes the seven audit PostgreSQL tests and two new schema lifecycle tests.
- `tests/test_daily_history_migrations.py` tests a fresh install and an upgrade from `f3a8c2d7e961`, legacy data digests, an empty canonical table, new application-role insert/update/delete grants, denial of role/ledger changes, rejection of duplicate identities and nonfinite prices, and downgrade to the prior revision. These tests create uniquely named databases on the isolated test instance and remove only those databases afterward.
- `python -m alembic heads`: one head, `a21c9e7d4b60`.

## Representative recovery-copy rehearsal

The source was the previously verified `p0b_upgrade` recovery copy at `f3a8c2d7e961` in container `p0b-pg17-upgrade`. It was not the development database or the hosted database. A custom-format dump was restored with `--no-owner --no-acl --exit-on-error` into a new `p1b_restore_*` database on the isolated `p0b-pg17-proofs` instance, loopback port 54329. Only the new target was migrated and had grants reapplied.

All 39 pre-existing application-table digests matched after upgrade: 15,165 rows preserved. All 34 sequence values and `is_called` flags matched. Ledger reconciliation checked 8 accounts with 0 failures before and after. The canonical table had 0 rows. Its SELECT/INSERT/UPDATE/DELETE grants passed; the application still lacked users.role UPDATE and ledger UPDATE/DELETE.

## Remaining boundaries

There was no provider fetch, historical backfill, scheduler change, hosted migration, deployment, or source commit. Canonical history remains empty until separately reviewed ingestion. Provider permission for collection/public display remains unresolved. The hosted schema remains the separately verified `f3a8c2d7e961`; this note does not claim the new local revision is deployed.

Disposable proof/browser/recovery containers and the additional rehearsal copy are retained for continued local work. No development or hosted rows were changed. The migration downgrade intentionally drops canonical bars; preserve them before a future production rollback once ingestion exists.

A later signed-in UI check upgraded only `p0b_browser` to this revision and reapplied matching grants before browser acceptance. Grok independently read the model, migration, contract and migration-test file and reported no concrete defect; it did not rerun commands or inspect the remaining files.
