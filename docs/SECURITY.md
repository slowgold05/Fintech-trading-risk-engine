# Reporting a security issue

Send a report through a private GitHub security advisory on `slowgold05/Fintech-trading-risk-engine`, or contact the repository owner directly. Do not put secret values, passwords, connection strings, or live account data in a public issue.

This file is the reporting policy. The product writeup is the root `Security.md`. A second root file named `SECURITY.md` is not used here, because this working copy's disk treats those two names as one file.

## Secret handling

- `.env` files are gitignored. `.env.example` contains empty placeholders.
- Do not commit API keys, bootstrap passwords, database URLs, or model checkpoints.
- Gitleaks runs on staged files when `.githooks/pre-commit` is installed, and the CI `secrets` job runs Gitleaks on the repository.
- `MASSIVE_API_KEY`, `FINNHUB_API_KEY`, `TWELVE_DATA_API_KEY`, and `KRONOS_CHECKPOINT` stay empty unless an owner decides to connect those services. Empty values do not call them.
- Local model files (`*.parquet`, `*.safetensors`, `*.pt`, `*.onnx`) and `/data/` are gitignored.

The current finding list is [AUDIT-001](security/AUDIT-001.md).
