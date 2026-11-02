# Sentinel Markets security controls

This is a mock brokerage. The [threat model](docs/THREAT_MODEL.md), [control matrix](grc/control_matrix.csv), and [control workpapers](grc/workpapers) describe the implemented safeguards and their evidence. The [action items](docs/GRC_ACTION_ITEMS.md) track gaps that remain open.

## Authentication and access

Passwords are hashed with bcrypt through Passlib. Login has per-IP rate limits and per-account backoff. Access tokens use PyJWT with a configured secret and required expiry; refresh tokens rotate and their hashes are stored in PostgreSQL. The AWS demo serves HTTPS with secure refresh cookies, HSTS, and API docs disabled. MFA and full access-token revocation are still open.

Trader routes require the trader role. Compliance routes require an admin, compliance officer, or auditor role, with mutation rights checked again by each endpoint. Admins request role changes, separate compliance officers approve them, and a privileged command applies them. The application database login cannot update `users.role`; a trigger records direct privileged role updates. SM-AC-01 and SM-AC-02 passed against the migrated AWS database.

## Trading and data integrity

Orders and direct trades require idempotency keys. Pre-trade checks enforce buying power, available shares, a 20% reference-price band, a 50% per-symbol concentration cap, and a $50,000 stock-position limit. Admins can halt or resume trading in the compliance console with an audited reason; a restart-based setting remains an emergency override. The latest hosted trading-halt, price-band, and idempotency operating checks had no live samples.

Trade accounting uses `Decimal` and balanced, hash-chained ledger postings. The application database role cannot update or delete ledger rows, and PostgreSQL triggers reject those operations. SM-LD-01 reconciles ledger hashes, cash, and positions; a manual AWS run checked eight accounts with no failures. Local nightly reconciliation is scheduled; a hosted scheduler and independent evidence storage remain open.

## Verification limits

CI defines Gitleaks, Bandit, pip-audit, Semgrep, and Trivy gates alongside tests. The draft PR's 2026-10-31 migration-documentation run passed all six jobs. Four hosted application controls passed in an operator run; three reported `no_sample`. Their evidence is saved on the development machine, while the API container reads its own empty evidence directory, so the live compliance console currently shows 11 `not_run` controls. The privileged migration login can change triggers and grants, and local evidence files remain writable by the machine operator. Lightsail deployment environment values are readable by project administrators. This public demo lacks MFA, a hosted refresh/reconciliation schedule, shared independent evidence retention, and a completed access review. These limits are tracked in the [action items](docs/GRC_ACTION_ITEMS.md) and [AWS runbook](docs/aws_deployment.md).
