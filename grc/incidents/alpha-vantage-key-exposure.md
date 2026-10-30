# Alpha Vantage API key exposure — incident postmortem

**Status:** Contained; evidence and retrospective review open

**Prepared:** 2026-10-30

**Owner:** Project owner

## Summary and scope

The prior Alpha Vantage API key was embedded in an error message in `app/services/price_service.py` and appeared in public Git history, as identified in the finance project GRC roadmap. The key value is intentionally omitted here. The affected asset was a market-data provider credential; no customer account or financial data exposure has been established from the available evidence.

## Timeline

| Event | Known timing |
| --- | --- |
| Key entered source and public history | Exact commit and date still to be confirmed. |
| Exposure found during roadmap security review | Before 2026-10-30; exact detection time not retained. |
| Code changed to load the replacement key from ignored `.env` | Before this postmortem. |
| Project owner confirmed old key revocation | Before 2026-10-30; provider confirmation artifact still to be attached. |
| Gitleaks added to CI and local staged/history scans run | By 2026-10-30; scans passed on the available branch history. |

## Impact assessment

Anyone who could read the public repository history may have seen the old key before revocation. The available record does not include Alpha Vantage usage logs, billing records, or provider-side revocation details, so unauthorized use cannot be ruled out. The current scans show no detected credential in the checked branch and staged changes; a passing scan does not establish that every historical copy was removed.

## Cause and containment

The credential was placed directly in a source error message and the repository lacked a secret-scanning gate at that time. The old key was revoked according to the owner, the replacement is kept in ignored local configuration, and the current CI `secrets` job runs Gitleaks. Main now requires a PR and six CI checks. No key value should be added to this document, issues, logs, or evidence artifacts.

## Open follow-up

1. Attach provider-side revocation confirmation and review usage during the exposure window; record any unexpected calls or charges.
2. Identify the exact exposed commits and public forks/copies. Coordinate any history rewrite with repository collaborators after preserving audit evidence; revocation remains the primary containment because a rewrite cannot remove copies already fetched.
3. Archive this postmortem, the CI run, and key-rotation evidence outside the app host. Have an independent reviewer sign off on closure.

**Closure decision:** Pending provider evidence and independent review.
