# AUDIT-001

**Date:** 2026-11-04
**Scope:** The Sentinel Markets working tree, including the expansion work and the controls already in that tree.
**Method:** Map the expansion Phase 0 checklist to files already in the repository, and record what this session did not do. This is not a penetration test. The public demo was not scanned. No secret value is written here. No new scanner was run against git history.

`docs/SECURITY_AUDIT.md` is the 2026-06-17 note. Several items it called high were later fixed in this working tree, including automated tests, `Decimal` prices, refresh-token rotation, rate limits, idempotency, and the stale-price rule. That older note is not the current finding list.

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Rotate an exposed GitHub token | Not done | This session did not find a GitHub token and did not rotate one. The known exposed secret is the Alpha Vantage key. The owner says it was revoked. Provider-side evidence is still not in the incident file. |
| Gitleaks pre-commit and CI | Already present | `.githooks/pre-commit` and the `secrets` job in `.github/workflows/ci.yml`. This session did not re-run that GitHub job. |
| Ignore `.env`, exports, and local model files | Present | `.gitignore` ignores `.env`, `grc/evidence/`, `*.parquet`, `*.safetensors`, `*.pt`, `*.onnx`, and `/data/`. `.env.example` has empty placeholders, including the expansion keys. |
| Branch protection | Recorded earlier, not re-checked here | The change-management note says `main` requires a pull request and the six CI checks. Approving reviews stay optional because the repository has one collaborator. This session did not query GitHub. |
| CI lint, tests, and pip-audit | Present | `.github/workflows/ci.yml` runs backend pytest, frontend lint/tests/build, Gitleaks, Bandit, pip-audit, Semgrep, and Trivy. Local pytest and the frontend checks passed on 2026-11-04. GitHub Actions was not re-run. |
| This audit | Written | This file. |
| Reporting policy | Written | `docs/SECURITY.md`. The root product note stays `Security.md`. |

## Findings

| ID | Severity | Finding | Evidence | Fix status |
| --- | --- | --- | --- | --- |
| F-01 | High | The hosted image lags the working tree. Register and order can still return 500 on the running image. The slowapi response-argument fix is only in the tree. | `docs/GRC_ACTION_ITEMS.md`, `tests/test_rate_limit.py` | Open. Deploy was not requested. |
| F-02 | High | Application secrets are environment values on the Lightsail service. There is no separate secret manager. Project administrators can read them. | `Security.md` | Open. |
| F-03 | High | An Alpha Vantage key was exposed. The owner says the provider key was revoked. The provider revocation artifact is not attached. | `grc/incidents/alpha-vantage-key-exposure.md` | Open. |
| F-04 | Moderate | Evidence still lives in the application database. An independent copy is not operating. R-08 and R-09 have no mapped control. | `grc/risk_register.yaml` | Open. |
| F-05 | Moderate | `MFA_REQUIRED` remains false. Passkey signing is not implemented. | `app/core/config.py` | Open by decision. Turning the flag on would fail SM-AC-04 for accounts that have not enrolled. |
| F-06 | Moderate | The scheduled price source is still Yahoo. Massive, Finnhub, and Twelve Data parsers refuse to call the network when the key is empty. | `app/services/market_providers.py`, `app/services/eod_service.py` | Open for the live path. |
| F-07 | Low | Approving reviews are optional on `main`. | Earlier change-management record. Not re-queried. | Accepted while the repository has one collaborator. |
| F-08 | Info | Git history was not scanned again in this session, so this note does not say the history is clean. | No new Gitleaks history run. | Open as a verification gap. |

Phase 0 is not closed. F-01, F-02, and F-03 are still high, and the token-rotation line was not performed.
