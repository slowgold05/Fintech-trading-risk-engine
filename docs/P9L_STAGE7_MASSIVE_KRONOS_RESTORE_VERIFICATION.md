# Stage 7 follow-up — real backup/restore drill extended to the new Massive/Kronos tables

Stage 7 step 1: "...a full restore-and-rollback cycle — extending the
disposable-Postgres proofs already done in
[docs/P0B_LOCAL_RESTORE_VERIFICATION.md](P0B_LOCAL_RESTORE_VERIFICATION.md)
... to the new Massive/LSE/Kronos code paths." The original restore
drill proved the mechanism (exact `pg_restore` command, full migration
chain, grant reapplication) against the original accounting tables
(`users`, `holdings`, `trades`, `cash_movements`, `assets`) only. It
never seeded or verified `market_bars_daily` (Massive) or
`forecast_jobs`/`forecast_results`/`forecast_evaluations` (Kronos). This
unit reruns the same real drill, this time with representative data in
those specific tables.

## What was run (same disposable, destroy-after-use discipline as P0B)

Two fresh `postgres:17` containers, created and destroyed specifically
for this check — never the user's own long-running `fintechapp-postgres`
dev container (port 5433), which was never touched by anything in this
unit:

1. **Source** (`fintechapp-restore-source-20261112`, port 5558): fresh
   container, `alembic upgrade head` run from empty (all 20 migrations,
   ending at `45d85a1871f0` — the same head as every other unit this
   session), then `configure_postgres_role.configure(...)` for the
   `fintech_app` role grants. Seeded via the app's own ORM models: 2
   `MarketSymbol` rows, 6 `MarketBarDaily` rows (`provider="massive"`,
   spanning 3 session dates across 2 symbols), 1 `User`, 1 `ForecastJob`
   (`status="completed"`), 1 `ForecastResult` (Kronos model/tokenizer
   names, a real JSON `bars` payload), 1 `ForecastEvaluation`. All
   synthetic, fictitious (`RSTR1`/`RSTR2` symbols, `restore-drill@example.com`).
2. **Dump**: `pg_dump -U ci_audit -d ci_audit -Fc -f ci_audit.dump` —
   same custom format as P0B and the hosted rehearsal. Copied to this
   session's scratchpad only, deleted at the end.
3. **Target** (`fintechapp-restore-target-20261112`, port 5559): a
   second, separate fresh container. Restored with the exact documented
   command: `pg_restore -U ci_restore -d ci_restore --single-transaction
   --clean --if-exists --exit-on-error --no-owner --no-acl`. Exit code 0.
4. **Verification**: `alembic_version` in the restored database is
   `45d85a1871f0` — matches the source. Every seeded table's row count
   matches exactly: `market_symbols 2, market_bars_daily 6,
   forecast_jobs 1, forecast_results 1, forecast_evaluations 1`. A
   restored `MarketBarDaily` row's symbol/session_date/open/quality_status
   matched the seeded values exactly; a restored `ForecastResult` row's
   `model_name`/`tokenizer_name` and its JSON `bars` list (length 1)
   survived the dump/restore cycle intact.
5. **Grant reapplication**: `configure_postgres_role.configure(...)` run
   again against the restored instance — succeeded, confirming
   `market_bars_daily` and `forecast_results` (both already present in
   that script's real grant list before this unit) are recreated
   correctly post-restore.

## What this closes, and what it does not

Closes: proof that the documented restore command, full migration
chain, and grant-reapplication script work correctly end-to-end for the
specific new Massive and Kronos tables — not previously demonstrated;
P0B only covered the original accounting tables. This is a logical
consequence of `pg_dump`/`pg_restore` being whole-database, schema-wide
operations rather than a per-table backup list, but this unit verifies
that consequence for real rather than asserting it by analogy.

Does not close: hosted recovery for these tables specifically (no AWS
access in this sandboxed session; hosted recovery was separately proven
for the original scope in `docs/aws_deployment.md`'s 2026-10-31 entry,
not re-verified here for any table). Does not cover LSE — no LSE adapter
or table exists yet to seed.

Both disposable containers and the local dump file were destroyed
immediately after this check; nothing persists.
