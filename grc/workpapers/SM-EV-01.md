# SM-EV-01 — Append-only control evidence

**Date:** 2026-11-03
**Control owner:** Compliance (second line)
**Status:** Design tested. Hosted privilege denial depends on the database migration and role grants.

## Risk and control

The compliance console used to read JSON files on the API host. Those files were not the files written by the operator, so the live console showed every control as not run. Evidence is now inserted into `control_evidence`. The application login may insert rows. A database trigger rejects updates and deletes, including by the table owner, and the application login is not granted update or delete.

## Test of design

Reviewed the migration, the insert-only grant in `configure_postgres_role`, and the console query that prefers the latest database row and reports `evidence_error` when the stored hash does not match the payload. The automated probe expects both a zero-row update and a zero-row delete to be denied. On SQLite, which has no role separation, the same probe correctly fails.

## Test of operating effectiveness

The denial is true only after `1c4e8a7b2d90` is applied and `configure_postgres_role` is rerun on PostgreSQL. A local SQLite result is not hosted evidence. The console shows a database result only from an API image that includes this change.

## Limits and follow-up

A database administrator can disable the trigger. That limitation is the existing privileged-login risk. A second copy outside the database, kept where the operator cannot edit it, is still open. File copies under `grc/evidence/` remain local working copies.
