# P3-B watchlist contract (planned)

Status: backend accepted on `codex/v2-watchlists-backend-20261107` at `31333a319e5a0104dacbf8ff1dfa4be2059513c6`. Evidence: [P3B_WATCHLIST_VERIFICATION.md](P3B_WATCHLIST_VERIFICATION.md). Code CI [42358277720](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42358277720) succeeded on all 7 jobs. Draft PR 23, stacked on PR 22, stays pending final documentation-head CI. That accepted code CI is not the later documentation head. UI is a later unit and is not implemented. Full P3-B and phase acceptance stay open. No merge and no deploy.

This unit adds persistent user-owned watchlists. It does not add prices, provider links, forecasts, orders, or research payloads. Later UI may link an owned symbol string to existing market and order clients.

## API

New router prefix `/watchlists`, dependency `get_current_user`. Any signed-in role may own lists. Collection routes use path `''` so GET and POST do not rely on a slash redirect.

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/watchlists` | — | 200 `{watchlists: [Watchlist]}` |
| POST | `/watchlists` | `{name}` | 201 one `Watchlist`, `symbols: []` |
| PATCH | `/watchlists/{watchlist_id}` | `{name?: string, symbol_order?: string[]}` | 200 that whole list |
| DELETE | `/watchlists/{watchlist_id}` | — | 204 empty |
| POST | `/watchlists/{watchlist_id}/symbols` | `{symbol}` | 201 whole list if new; 200 whole list if already a member |
| DELETE | `/watchlists/{watchlist_id}/symbols/{symbol}` | — | 204 empty |

`Watchlist` is `{id, name, symbols: [{symbol, position}]}`. Responses omit user ids. Unauthenticated calls stay the existing `get_current_user` **401**. Path ids must be positive integers, else **422**. A missing list and another owner’s list are the same **404** `Watchlist not found`. A symbol missing from an owned list is **404** `Symbol not found on watchlist`.

Bodies are extra-forbid. Explicit null is invalid. PATCH requires `name`, `symbol_order`, or both. At least one field must be present.

## Read

GET is one owner-filtered `watchlists LEFT JOIN watchlist_items`, ordered by list id, item position, symbol. Empty lists are included. Caps bound the result at 20 lists by 50 members. One statement avoids an N+1 membership read.

## Storage

One migration with `down_revision` `a21c9e7d4b60`. No unrelated table changes.

- `watchlists`: `id`, `user_id` FK to `users.id` `ON DELETE CASCADE`, `name`. Unique `(user_id, name)`, case-sensitive after strip, max 40. No `created_at`.
- `watchlist_items`: composite primary key `(watchlist_id, symbol)`. `watchlist_id` FK `ON DELETE CASCADE`. `symbol` FK to `market_symbols.symbol` `ON DELETE RESTRICT`. `position` integer check `>= 1`. No unique `(watchlist_id, position)`, so a reorder does not need a transient conflicting position. No `created_at`.

`app.core.database.Base` is an uncustomized `declarative_base()`, so no timestamp column is required. Do not write user columns.

## Validation

Name: trim, length 1–40, else **422**. Duplicate owner name is **409** `Watchlist name already exists`, and the transaction rolls back. Rename does not revalidate symbol activity.

Symbol: existing order policy only — trim, uppercase, length 1–20. No new alphabet. A **new** member must be an active `MarketSymbol`, else **400** `Unknown or inactive stock symbol`. Deactivation does not remove a member.

Caps: 20 lists per user and 50 members per list, else **409**. Append uses `max(position)+1`.

PATCH `symbol_order` is checked under the list lock. After the same normalization it must be exactly the current membership, unique, and then positions become `1..n`. Anything else is **422** and rolls back the rename too.

Existing membership is checked under the list lock **before** active-symbol validation. POST of a current member returns **200** and the whole list even when that symbol is inactive. Delete of a list removes only that list and its items.

## Writes and locks

Auth has already read the session. Copy `current_user.id` to a plain int **before** `db.rollback()`. Then open a fresh transaction. Never update cash, role, or any user column, and do not widen user grants. No lock table, in-memory lock, or new dependency.

PostgreSQL, required proofs:

- CREATE and rename: `SELECT … FOR UPDATE` the owner `users` row **before** the list count or rename. Then, when the list exists, `SELECT … FOR UPDATE` the owned watchlist row. Lock order is always user, then list.
- Add, remove, reorder, and list delete: lock the owned watchlist row before the membership check, member count, or delete.
- Create-at-19 with two different names ends at 20. Add-at-49 ends at 50. Duplicate add returns the existing member. List delete that wins, then add, is **404**. If add commits and a later delete runs, that delete removes the member. Do not describe add-wins as a member that survives a later delete.
- Observe blocking with `pg_blocking_pids`, bounded threads, and separate sessions.

SQLite ignores `FOR UPDATE`. Do not fake row locks, do not write cash, and do not change the engine or harness globally. In the watchlist unit only, on the SQLite dialect branch, start a fresh transaction with a narrow `BEGIN IMMEDIATE` before the watchlist read or count, matching the existing `read_snapshot` dialect branch. A bounded SQLite file-writer concurrency cap proof is required to verify that `BEGIN IMMEDIATE`: separate connections, real writers, no deferred or optional race. PostgreSQL proofs stay mandatory. A bounded operational busy or locked error becomes **503** with a generic retryable detail and no SQL text. Do not map other errors to 503.

## Migration and grants

`configure_postgres_role` adds only `INSERT, UPDATE, DELETE` on `watchlists` and `watchlist_items`. Existing `SELECT` on all tables, sequence grants, and `users` column grants stay unchanged.

Role proof uses an isolated allowlisted PostgreSQL instance, established before any connect or role rotation. It is fresh CI only, not prod or dev. Whether `SELECT … FOR UPDATE` on `users` is allowed under the existing app grants is unproved and must be tested; this contract does not claim that permission already works. The same proof then inserts, updates, and deletes the two new tables. `UPDATE users.role` stays denied. Ledger `UPDATE` and `DELETE` stay denied. This proof must pass under existing grants; any failure is a concrete review blocker, with no permission widening or cash-write workaround.

`tests/test_daily_history_migrations.py` keeps its current `a21` historical asserts and digests. `upgrade head` runs after those historical checks and before configuring current grants. The existing downgrade to the previous revision and its digest proof stay. New migration checks: a fresh database and an upgrade from the preserved baseline keep existing rows; downgrade drops only the two new tables and preserves that baseline.

## Tests to write

API: **401**; owner B and an unknown id both **404** with no owner leak; body and cap failures; atomic rename plus invalid order; duplicate reorder **422**; new inactive symbol **400**; existing inactive member **200**; sorted GET from one join. API tests must keep cash and ledger rows unchanged, because locks do not write `users`. Concurrency tests are the PostgreSQL cases above, plus the required SQLite file-writer cap proof. This document does not claim those tests have been run.
