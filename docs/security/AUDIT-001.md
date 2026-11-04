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

Release addendum: the statuses below incorporate the 2026-11-04 rollout. The checklist above records the initial audit's verification limits. Release CI subsequently passed all six jobs, Gitleaks history and staged scans passed, and live HTTP checks verified the updated image. Browser click-through and a penetration test were not performed.

| ID | Severity | Finding | Evidence | Fix status |
| --- | --- | --- | --- | --- |
| F-01 | High | The hosted image previously lagged the reviewed code, including the slowapi response-argument fix. | `docs/GRC_ACTION_ITEMS.md`, `docs/aws_deployment.md`, `tests/test_rate_limit.py` | Closed by deployment 7 on 2026-11-04. Live registration, login, cash replay, and order placement/replay/cancellation passed. |
| F-02 | High | Application secrets are environment values on the Lightsail service. There is no separate secret manager. Project administrators can read them. | `Security.md` | Open. |
| F-03 | High | An Alpha Vantage key was exposed. The owner says the provider key was revoked. The provider revocation artifact is not attached. | `grc/incidents/alpha-vantage-key-exposure.md` | Open. |
| F-04 | Moderate | Evidence still lives in the application database. An independent copy is not operating. R-08 and R-09 have no mapped control. | `grc/risk_register.yaml` | Open. |
| F-05 | Moderate | `MFA_REQUIRED` remains false. Passkey signing is not implemented. | `app/core/config.py` | Open by decision. Enrollment is now hosted, but SM-AC-04 fails while accounts have not enrolled. Recovery and secret rotation remain unresolved. |
| F-06 | Moderate | The scheduled price source is still Yahoo. Massive, Finnhub, and Twelve Data parsers refuse to call the network when the key is empty. | `app/services/market_providers.py`, `app/services/eod_service.py` | Open for the live path. |
| F-07 | Low | Approving reviews are optional on `main`. | Earlier change-management record. Not re-queried. | Accepted while the repository has one collaborator. |
| F-08 | Info | A fresh history scan was missing when this audit was written. | Release preparation ran Gitleaks against history with no leaks found; staged scans and the CI secrets job passed. | Verification gap closed for the 2026-11-04 release. Provider revocation evidence in F-03 remains a separate open item. |

Phase 0 is not closed. F-01 is resolved, but F-02 and F-03 remain high. No GitHub token rotation was claimed. The release used a separate private migration runner, which was deleted afterward; the web deployment contains only its normal application credentials, not the migration credential. Independent evidence retention and owner approvals also remain open.
