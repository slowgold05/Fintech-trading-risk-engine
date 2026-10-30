# SM-SM-01 — Secret scanning on repository changes

**Date:** 2026-10-30
**Control owner:** Security Operations (second line)
**Status:** Provisional; independent review pending

## Risk and control

A committed credential could be exposed. The CI `secrets` job uses Gitleaks with full checkout history. `app.scripts.check_repository_controls` verifies that job passed on the latest push run for the checked-out commit and writes dated evidence.

## Test and evidence

The [2026-10-30 push run](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/41101445894) passed the secrets job for commit `1a228f7`. The control command matched that commit to the run and passed: `grc/evidence/SM-SM-01/52c2e449c40648099980d809701facec.json`, SHA-256 `c516683542ca13965daa9721f9fd10431871d6b50da9ca69921b55793c85711e`. A local redacted Gitleaks history scan and staged scans also found no leaks.

## Limits and follow-up

The prior Alpha Vantage key was revoked, but revocation confirmation still needs independent retention with the incident record. A passing scan does not prove every secret type was detected, and local evidence can be altered by the machine operator. Archive the CI result and evidence outside the app host.
