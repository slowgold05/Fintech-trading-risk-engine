# SM-AC-01 — Application database role separation

**Date:** 2026-10-29
**Control owner:** Security Operations (second line)
**Status:** Local design and operation tested; independent review pending

## Risk and control

If the API's database login can change user roles or alter reviews, a compromised trading request could hide unauthorized access. The local `fintech_app` login can read users, insert accounts without specifying a role, and update cash balances. It cannot update `users.role`, write `role_changes`, or edit access reviews. New accounts default to `trader`. After initial bootstrap, an admin requests a role change, a distinct compliance officer approves it, and the privileged command applies the approved request with a linked audit record.

## Test of design

Reviewed migrations `b8c26f9d4357`, `d2a6f9c4b781`, `e3b7c4d5a901`, and `f4c8d5e6b012`, the role checks on trading and compliance routes, and `app/scripts/set_user_role.py`. The `role_changes` and `access_reviews` tables have triggers that reject updates and deletes. The API rejects a trader from compliance endpoints, an auditor from trade and order writes, an admin from approving their own role request, and a reviewer from reviewing their own access. Automated tests cover these paths and the linked audit record. Approval and review snapshots include the latest role-change ID, so an account changed away and back still needs fresh review.

## Test of operating effectiveness

Population: the local MySQL application login and four protected columns. The live control run attempted zero-row updates to `users.role`, `role_changes.reason`, `role_change_requests.target_user_id`, and `access_reviews.reason`; all four were denied by MySQL privileges. Evidence: `grc/evidence/SM-AC-01/eddef29a2bce46ccad6272904cdb4aa2.json`, SHA-256 `f8715a9df328c2d439d526fee45bd653b53573a7f81a94bed6c5bdcd00214b63`.

Separate rollback-only smoke checks confirmed that the app login can insert a pending role request, record an approval, and insert an access review. Earlier checks confirmed default trader registration, cash updates, role-update denial, and append-only role-change records. No real access review or approved role change has yet been performed.

## Limits and follow-up

This tests the local MySQL grants only. Apply and verify equivalent grants in deployment. SM-AC-02 separately tests the role-audit trigger. A holder of the migration login can still bypass application approval or alter the trigger; restrict and independently monitor that login before claiming full segregation of duties. Schedule the control, archive evidence outside this writable workspace, and obtain independent review.
