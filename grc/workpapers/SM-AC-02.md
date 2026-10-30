# SM-AC-02 — Database-triggered role-change audit

**Date:** 2026-10-29
**Control owner:** Security Operations (second line)
**Status:** Local design and operation tested; independent review pending

## Risk and control

The migration login can update `users.role` directly. An `AFTER UPDATE` trigger writes the old role, new role, actor, reason, and optional approved-request ID to the append-only `role_changes` table. The operator command sets audit context, checks the new audit row, and commits the role and audit together.

## Test of design

Reviewed migration `a5d9e6f7c123` and `app/scripts/set_user_role.py`. The trigger fires only when the role value changes. With no operator context it labels the reason `Direct database role update`; with the approved command it captures the request ID and operator. The existing role-change trigger rejects edits and deletes.

## Test of operating effectiveness

The privileged control ran one rollback-only direct role update against a local MySQL account. It observed exactly one matching audit row and rolled back both changes. Evidence: `grc/evidence/SM-AC-02/b21728a16f114589bc103e028b7828f3.json`, SHA-256 `3d3c915344c415c693179b49254ad25d1f84b8d50784c3ecff05641937105a1c`. A second rollback-only smoke check confirmed the operator command produced exactly one row with its actor and reason.

## Limits and follow-up

This tests the local MySQL trigger. Apply the migration and rerun the control in deployment. A holder of schema-changing privileges can disable or replace the trigger, so independent database audit and restricted migration credentials remain necessary. No actual role change was committed by these tests.
