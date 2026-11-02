# Access control policy — draft

**Owner:** Security Operations

**Status:** Draft for owner approval

**Scope:** Sentinel Markets application accounts, database roles, and privileged operator access

## Requirements

1. New application accounts start as `trader`. Privileged roles are granted only for a documented need and use the minimum access required. Traders cannot enter compliance administration routes; auditors can inspect but cannot submit access changes.
2. An admin requests a role change, a different compliance officer approves it, and a privileged operator applies the approved request. The first account in each privileged role may be bootstrapped with a recorded reason. Direct database role updates are audited by a trigger.
3. Admins and compliance officers review each account at least quarterly, record retain or remove with a reason, and do not review their own account. A role change reopens that account's review. A remove decision starts remediation; it does not silently change access.
4. The API uses a restricted database login. It cannot update user roles, role-change evidence, access reviews, or ledger postings. Alembic and approved role changes use a separate migration login. Access to that login is limited to operators and monitored independently before production use.
5. Access is removed when no longer needed. MFA is required before production use; the current app does not yet provide it.

## Evidence and exceptions

SM-AC-01 checks app database grants. SM-AC-02 checks direct role-update auditing. Access-review rows provide account decisions and reviewer identity. No completed quarterly review has been recorded yet, and independent monitoring of the migration login remains open. Exceptions require an owner, reason, expiry, and remediation plan; no exception process is automated yet.

**Approval:** Pending policy owner review.
