# SM-CM-01 — Protected change and CI gate

**Date:** 2026-10-30
**Control owner:** Security Operations (second line)
**Status:** Provisional; independent review pending

## Risk and control

An untested change could reach `main`. GitHub branch protection now requires a pull request, up-to-date checks for backend, frontend, secrets, Python security, static analysis, and dependency scanning, and applies the gate to administrators. `app.scripts.check_repository_controls` compares that live rule and the latest push run with the checked-out commit, then writes dated evidence. The separate approval requirement is still open.

## Test and evidence

The rule was read back from GitHub after configuration and listed all six required checks, strict status checking, administrator enforcement, and a pull-request requirement. The [2026-10-30 push run](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/41101445894) passed all six jobs for commit `1a228f7`. The control command matched that commit to the run and passed: `grc/evidence/SM-CM-01/871f8fc7fe2c47d689d005ed6d222fc0.json`, SHA-256 `4e35af077141ebea91444a79af8c8043c6eab94d67929da32b48b0a7c195c4aa`.

## Limits and follow-up

The repository has one collaborator, so the rule currently requires zero approving reviews. Add another reviewer and require at least one approval before claiming independent change review. The script proves the live rule and CI result, not that every past merge complied. Archive evidence outside the app host and review exceptions.
