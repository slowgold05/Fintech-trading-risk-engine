# SM-CM-01 — Protected change and CI gate

**Date:** 2026-10-30
**Control owner:** Security Operations (second line)
**Status:** Provisional; independent review pending

## Risk and control

An untested change could reach `main`. GitHub branch protection now requires a pull request, up-to-date checks for backend, frontend, secrets, Python security, static analysis, and dependency scanning, and applies the gate to administrators. `app.scripts.check_repository_controls` compares that live rule and the latest push run with the checked-out commit, then writes dated evidence. The separate approval requirement is still open.

## Test and evidence

The rule was read back from GitHub after configuration and listed all six required checks, strict status checking, administrator enforcement, and a pull-request requirement. The first hosted run passed all six jobs: https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/41096456291. Run the control command after the current commit's push CI completes; its JSON result and SHA-256 digest appear under ignored `grc/evidence/SM-CM-01/`.

## Limits and follow-up

The repository has one collaborator, so the rule currently requires zero approving reviews. Add another reviewer and require at least one approval before claiming independent change review. The script proves the live rule and CI result, not that every past merge complied. Archive evidence outside the app host and review exceptions.
