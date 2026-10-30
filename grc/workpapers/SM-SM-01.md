# SM-SM-01 — Secret scanning on repository changes

**Date:** 2026-10-30
**Control owner:** Security Operations (second line)
**Status:** Provisional; independent review pending

## Risk and control

A committed credential could be exposed. The CI `secrets` job uses Gitleaks with full checkout history. `app.scripts.check_repository_controls` verifies that job passed on the latest push run for the checked-out commit and writes dated evidence.

## Test and evidence

The first hosted run passed the secrets job: https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/41096456291. A local redacted Gitleaks history scan and staged scans also found no leaks. Run the control command after the current commit's push CI completes; its JSON result and SHA-256 digest appear under ignored `grc/evidence/SM-SM-01/`.

## Limits and follow-up

The prior Alpha Vantage key was revoked, but revocation confirmation still needs independent retention with the incident record. A passing scan does not prove every secret type was detected, and local evidence can be altered by the machine operator. Archive the CI result and evidence outside the app host.
