# Access control policy — draft

**Owner:** Security Operations

**Status:** Draft for owner approval

**Scope:** Sentinel Markets application accounts, database roles, and privileged operator access

## Requirements

1. New application accounts start as `trader`. Privileged roles are granted only for a documented need and use the minimum access required. Traders cannot enter compliance administration routes; auditors can inspect but cannot submit access changes.
2. An admin requests a role change, a different compliance officer approves it, and a privileged operator applies the approved request. The first account in each privileged role may be bootstrapped with a recorded reason. Direct database role updates are audited by a trigger.
3. Admins and compliance officers review each account at least quarterly, record retain or remove with a reason, and do not review their own account. A role change reopens that account's review. A remove decision starts remediation; it does not silently change access.
4. The API uses a restricted database login. It cannot update user roles, role-change evidence, access reviews, or ledger postings. Alembic and approved role changes use a separate migration login. Access to that login is limited to operators and monitored independently before production use.
5. Access is removed when no longer needed. A confirmed authenticator is a six-digit time-based code. The secret is stored encrypted. `MFA_REQUIRED` defaults to false so an existing demo account can still sign in with a password. When the flag is true, an account with no confirmed factor cannot receive a session. An enrolled account always completes a code before a session is issued. A high-risk login with no factor is denied. A limit or market order at or above `LARGE_ORDER_STEP_UP_NOTIONAL` (default $10,000) asks an enrolled account for a current code. That code is the same authenticator. It is not a passkey. Passkey signing is not implemented.

## Evidence and exceptions

SM-AC-01 checks app database grants. SM-AC-02 checks direct role-update auditing. SM-AC-03 fails while any current role lacks an independent review for the open quarter. SM-AC-04 fails while any account has no confirmed authenticator; an empty book is `no_sample`. SM-AC-05 fails when a high-risk login succeeded without step-up. SM-AM-01 checks that the repo inventory lists the web API, database, source repository, and evidence store. The Q4 2026 access review recorded on 2026-11-03 is the first completed review. It was retain-only and did not change roles. NYDFS 500.12 operating effectiveness is not met until every account is enrolled and `MFA_REQUIRED` is on. The hosted image does not run this control yet. Independent monitoring of the migration login remains open. Exceptions require an owner, reason, expiry, and remediation plan; no exception process is automated yet.

**Approval:** Pending policy owner review.
