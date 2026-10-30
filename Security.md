# Sentinel Markets security controls

This is a mock brokerage. The [threat model](docs/THREAT_MODEL.md), [control matrix](grc/control_matrix.csv), and [control workpapers](grc/workpapers) describe the implemented safeguards and their evidence. The [action items](docs/GRC_ACTION_ITEMS.md) track gaps that remain open.

## Authentication and access

Passwords are hashed with bcrypt through Passlib. Login has per-IP rate limits and per-account backoff. Access tokens use PyJWT with a configured secret and required expiry; refresh tokens rotate and their hashes are stored in MySQL. MFA and full access-token revocation are still open.

Trader routes require the trader role. Compliance routes require an admin, compliance officer, or auditor role, with mutation rights checked again by each endpoint. Admins request role changes, separate compliance officers approve them, and a privileged command applies them. The application database login cannot update `users.role`; a trigger records direct privileged role updates. SM-AC-01 and SM-AC-02 test these controls on the local database.

## Trading and data integrity

Orders and direct trades require idempotency keys. Pre-trade checks enforce buying power, available shares, a 20% reference-price band, and a 50% per-symbol concentration cap. New trades can be halted through a restart-based setting. SM-PT-02 and SM-PT-04 test price bands and committed idempotency records; the last local runs had no live samples for those two operating checks.

Trade accounting uses `Decimal` and balanced, hash-chained ledger postings. The application database role cannot update or delete ledger rows, and MySQL triggers reject those operations. SM-LD-01 reconciles ledger hashes, cash, and positions. A scheduled reconciliation and independent evidence storage remain open.

## Verification limits

CI defines Gitleaks, Bandit, pip-audit, Semgrep, and Trivy gates alongside tests. Local tests, dependency audits, Bandit, Semgrep, and a redacted Gitleaks scan of available history have passed; the hosted workflow and Trivy run still require verification. The privileged migration login can change triggers and grants, and local evidence files remain writable by the machine operator. These limits are tracked in the [action items](docs/GRC_ACTION_ITEMS.md).
