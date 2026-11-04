# Information security policy — draft

**Owner:** Security Operations

**Status:** Draft for owner approval

**Scope:** The Sentinel Markets API, web client, database, and repository

## Requirements

1. Passwords are hashed. Access tokens expire. Refresh tokens rotate, and the database stores the hash. The public demo serves HTTPS. API docs are disabled on that image.
2. Authenticator secrets are encrypted with a keystream from `JWT_SECRET` before storage. `MFA_REQUIRED` defaults to false. An enrolled account completes a code before a session. A high-risk login with no factor is denied. Passkey signing is not implemented.
3. The API uses a restricted database login. It cannot update roles, role-change records, access-review reasons, halt reasons, or ledger rows, and it cannot update or delete control evidence. Alembic uses a separate migration login. That login is not part of the long-lived API deployment.
4. User requests do not call market-data providers. Provider credentials stay in ignored environment files. The exposed Alpha Vantage key was replaced locally. Provider-side revocation evidence is still not attached.
5. The hosted database has public access off. This draft does not claim a customer-managed encryption review or a penetration test. Those items are not in the repository.

## Evidence and exceptions

SM-AC-01, SM-AC-02, SM-AC-04, SM-AC-05, and SM-AM-01 are the related controls. The asset inventory is a repository file and is pending asset owner review. Exceptions require an owner, reason, expiry, and remediation plan. No exception process is automated yet.

**Approval:** Pending policy owner review.
