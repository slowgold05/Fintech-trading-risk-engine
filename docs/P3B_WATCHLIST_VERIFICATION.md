# P3-B watchlists — backend verification

Accepted code `31333a319e5a0104dacbf8ff1dfa4be2059513c6` on `codex/v2-watchlists-backend-20261107`. Draft [PR 23](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/23) is stacked on PR 22. [CI 42358277720](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42358277720) is the accepted code run: all 7 jobs succeeded. No formal GitHub approval is claimed. The pull request stays a draft until documentation-head CI finishes. This note does not record that later head. Full P3-B and phase checks stay open. The watchlist UI is not in this unit.

## Accepted code CI

Backend, Python 3.12, fresh isolated PostgreSQL 17.11: 277 passed, 5 optional Selenium modules skipped, 906 warnings, 122.55s. Frontend: 227 tests in 21 files; lint and build passed. Browser: 8 passed, 1 hosted case deselected, 109 warnings, 92.49s. That browser job is the existing regression only. It has no watchlist UI and no new UI captures. Security, static analysis, dependency, and secrets jobs passed.

## Earlier CI

[CI 42357933676](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42357933676) is not all green. Its six new PostgreSQL proofs passed. One older audit test still expected Alembic head `a21c9e7d4b60`, and the browser job had eight setup errors on that same old head. The correct `b73e2d9f6a10` database was refused before Chrome started, so the guards worked. `31333a3` changes only those two current-head expectations. Historical daily-history asserts stay on current `a21c9e7d4b60`. The new migration baseline stays `a21c9e7d4b60`. The existing daily-history migration test still upgrades to head only after that historical assert and its digest proof.

## Local checks

Full suite with `AUDIT_DATABASE_URL` unset: 256 passed, 26 skipped, 967 warnings, 77.77s. The skips are 21 PostgreSQL checks and 5 optional browser modules. No local PostgreSQL proof is claimed.

Focused watchlist file: 8 passed, 58 warnings, 6.17s. That includes a real SQLite file where the second create reaches `BEGIN IMMEDIATE` and stays blocked until the holder commits, ending at 20 lists with one 201 and one 409, and a 0.2s busy timeout that returns 503 while the holder is still unreleased. It also covers a slash symbol add and remove, one `LEFT JOIN` GET with no SQLite writer lock, strict private create/read/update/delete, caps, atomic reorder, a new inactive symbol versus an existing inactive member, and unchanged cash and ledger rows.

The six new PostgreSQL tests were collected locally and skipped. Frozen in-memory SQLite upgrade, downgrade, index, and primary-key checks passed. AST checks on the new code passed. One isolation test passed with 16 warnings. An early `tmp_path` permission error outside the workspace was fixed by a fresh workspace base temporary directory. The engine and harness were not weakened.

## Proofs in the new tests

`tests/test_watchlists_postgres.py` uses `NullPool` and separate sessions. The holder pauses after the named `SELECT … FOR UPDATE`. An observer session reads `pg_blocking_pids` for the waiter’s connection PID and requires the holder’s connection PID in that list, then rolls back. Threads are released and joined. Create at 19 plus two names waits on `users` and ends at 20; the waiter is 409. Add at 49 plus two symbols waits on the list and ends at 50; the waiter is 409. A duplicate add is 201 then 200 and leaves one item. A delete that holds the list makes the waiting add 404 `Watchlist not found`, with the list gone and no orphan items. Cash and the ledger count stay unchanged.

`tests/test_watchlist_migrations.py` has two real cases, fresh empty head and a seeded upgrade from `a21c9e7d4b60`. Both preserve baseline table digests. As `fintech_app`, `SELECT` the user `FOR UPDATE` on an existing column works, then the handlers and raw insert/update/delete run on the two new tables. `UPDATE users.role` is denied. Ledger `UPDATE` and `DELETE` are denied. The user row proof and the ledger digest stay unchanged. Each case uses a new isolated database on the allowlisted fresh CI instance only, and cleanup drops that database. Migration `b73e2d9f6a10` follows `a21c9e7d4b60` and adds `watchlists` and `watchlist_items`. The new grant is insert, update, and delete on those two tables only. Users, ledger, and other privileges are not widened.

## Boundaries

The runtime matches the contract: missing and other-owner lists are 404, caps are 20 and 50, bodies are strict, GET is one read-only join, PostgreSQL lock order is user then list, SQLite writes use `BEGIN IMMEDIATE` with a bounded retryable 503, positions may have gaps, PATCH reorder must be the exact membership, a new member must be active, and an existing inactive member still returns. Financial, auth, provider, and execution policies are unchanged. No new library.

No hosted or development database mutation, migration, or role operation. No merge, deploy, or AWS change. The mounted-only unknown-order retry still loses its intent on reload or unmount. That remains a P7 release gate.

## Next

Next is the watchlist UI: an owner-verified cache, abort of late queries and mutations, create/read/update/delete and ordering, form-draft navigation, and a symbol-only trade link in the existing Impeccable world. No new provider fetch and no automatic order. That UI is a separate unit. P1 providers, calendar, and ingestion stay open. P3-A indicators stay open. P4 and later, and the core release gate, stay open.
