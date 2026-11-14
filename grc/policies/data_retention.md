# Data retention policy — draft

**Owner:** Operations

**Status:** Draft for owner approval

**Scope:** Ledger postings, control evidence, cases, and login events stored by Sentinel Markets

## Requirements

1. Ledger postings are hash-chained. The application login cannot update or delete them. PostgreSQL triggers reject those statements. Control evidence rows are append-only for that same login.
2. This draft does not set a destruction date. No job deletes ledger rows, evidence, cases, or login events. Keeping the demo history is the current behavior, not an approved retention schedule.
3. A copy of evidence outside the database is still open. R-08 has no linked control. Lightsail automatic backups and the manual snapshot are operator recovery copies. They are not an independent evidence archive.
4. Sanctions screens store the name that was checked, the decision, and the source. They do not store a downloaded sanctions database. The local fixture is a single fake name.

## Evidence and exceptions

SM-LD-01 reconciles the ledger. SM-EV-01 checks that the application login cannot change evidence rows. SM-AU-01 checks that a stored evidence payload still matches its sha256. Zero evidence rows is `no_sample`. Exceptions require an owner, reason, expiry, and remediation plan. No exception process is automated yet.

**Approval:** Pending policy owner review.
