# Paper-account ledger

Each new account gets an opening snapshot. A trade writes four postings in the same transaction as its fill: two USD postings for cash and its offset, and two asset-unit postings for the position and its offset. Every event balances by unit. Entries carry a per-account SHA-256 chain over their content and predecessor hash.

Portfolio reset now preserves trades and risk assessments. It records a balancing reset event, clears current lots and holdings, and restores the $100,000 paper balance. Historical trades remain visible.

Apply migrations before starting the updated API. Then initialize accounts created before this ledger:

```powershell
python -m alembic upgrade head
python -m app.scripts.reconcile_ledger --initialize
```

Run reconciliation nightly:

```powershell
python -m app.scripts.reconcile_ledger
```

The command writes a dated JSON file under `grc/evidence/SM-LD-01/` and prints its SHA-256 digest. Preserve both outside this repository for audit evidence; the local file itself can be deleted. It exits with status 1 for a broken hash chain, an unbalanced event, or cash or positions that differ from the ledger.

Existing accounts start from a labeled snapshot; earlier trades are outside its coverage. The migration blocks updates and deletes on ledger rows with database triggers. The local PostgreSQL API uses a separate `fintech_app` login with only `SELECT` and `INSERT` on the ledger table. `MIGRATION_DATABASE_URL` retains the schema-change login for Alembic. Re-run `python -m app.scripts.configure_postgres_role` after future migrations; do not give the app role database-wide `UPDATE`, `DELETE`, `ALTER`, or `TRIGGER` privileges.
