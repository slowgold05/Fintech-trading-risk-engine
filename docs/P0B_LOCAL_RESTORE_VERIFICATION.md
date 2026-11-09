# Phase 0 gate — disposable backup and restore, local mechanism proof

The "Gates that stay explicit" table's "Disposable backup and restore" row
has read "Documented in `docs/aws_deployment.md`. Not executed here. P0-B
requires a successful restore into an isolated instance, not a backup
listing" since the P0-A baseline. `aws_deployment.md` already documents a
**real hosted** restore rehearsal from 2026-10-31 (Lightsail, AWS). This
unit does not repeat or re-verify that hosted rehearsal — no AWS access
exists in this sandboxed session. What it adds: a **local, disposable**
proof that the restore mechanism itself — the exact documented
`pg_restore` command, the full migration chain, and grant reapplication —
works correctly, using representative synthetic data, now that Docker is
available for the first time this session.

**This does not prove hosted recovery.** Stated explicitly per the gate's
own acceptance criteria ("If the available backup does not prove hosted
recovery, state that limitation explicitly"). Hosted recovery was already
proven separately in `aws_deployment.md`'s own 2026-10-31 entry.

## What was run, and why it's safe

Two **fresh, disposable** `postgres:17` containers, created and destroyed
specifically for this check — never the user's own long-running
`fintechapp-postgres` dev container, which was never connected to, read
from, or written to by any command in this unit:

1. **Source** (`fintechapp-backup-source`, port 5556): fresh container,
   `alembic upgrade head` run against it (all 20 migrations applied
   cleanly from empty, ending at `45d85a1871f0`, the current head), then
   `app.scripts.configure_postgres_role.configure(...)` to create the
   `fintech_app` role with its real grants. Seeded representative
   accounting data via the app's own ORM models (not raw SQL): 1 `Asset`,
   5 `User` rows, 5 `Holding` rows, 5 `Trade` rows, 5 `CashMovement`
   rows — the same tables and relationships the gate's own text names
   ("accounting relationships"). All synthetic, fictitious data
   (`backup-proof-N@example.com`), discarded with the container afterward.
2. **Dump**: `pg_dump -U ci_audit -d ci_audit -Fc -f ci_audit.dump` —
   custom format, the same format `aws_deployment.md`'s own hosted
   rehearsal used. Copied out of the container into this session's
   scratchpad directory only, never committed, never left on disk after
   the check (deleted at the end, per the gate's "keep dumps ... in
   restricted, ignored storage").
3. **Target** (`fintechapp-restore-target`, port 5557): a second, separate
   fresh container — never the source container, never the real dev
   container. Restored with the **exact documented command** from
   `aws_deployment.md`: `pg_restore -U ci_restore -d ci_restore
   --single-transaction --clean --if-exists --exit-on-error --no-owner
   --no-acl`. Exit code 0.
4. **Verification**: `alembic_version` in the restored database is
   `45d85a1871f0` — matches the source exactly. Every seeded table's row
   count matches the source exactly: `users 5, holdings 5, trades 5,
   cash_movements 5, assets 1`.
5. **Grant reapplication**: ran `configure_postgres_role.configure(...)`
   against the restored instance — succeeded, creating the `fintech_app`
   role with its grants on the restored schema.
6. **Functional check**: ran `tests/test_audit_postgres.py` (role
   separation, the role-change audit trigger, and the two real-thread
   concurrency tests) against the **restored** instance —
   **7 passed**, the same result as the fresh-container run documented in
   [P0C_POSTGRES_CONCURRENCY_VERIFICATION.md](P0C_POSTGRES_CONCURRENCY_VERIFICATION.md),
   now also confirmed on data that went through a real dump/restore
   cycle, not just a fresh schema.

## What this closes, and what it does not

Closes: proof that this app's documented restore command, full migration
chain, and grant-reapplication script work correctly end-to-end against a
real PostgreSQL 17 instance with representative accounting data — not
previously demonstrated in this session (only described in prose before
Docker was available).

Does not close: hosted recovery (needs AWS access, already proven
separately and not re-verified here), or recovery from an actual
production-shaped backup with real account history (this used synthetic
seed data, explicitly not a claim of "this specific backup recovers the
real hosted dataset"). The gate's other four unrelated rows (hosted
account reconciliation, authenticated browser journey, provider rights
review, hosted/local divergence) are untouched by this unit.

All three disposable containers and the local dump file were destroyed
immediately after this check; nothing persists.
