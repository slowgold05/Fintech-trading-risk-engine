# SM-AC-05 — High-risk logins use step-up

**Date:** 2026-11-04
**Control owner:** Security Operations (second line)
**Status:** Design tested. There is no hosted login-event population.

## Risk and control

A session issued after a high-risk login, without a second factor, leaves credential stuffing and new-device sign-in unchecked. SM-AC-05 reads `login_events`. A violation is a row with `risk_score` of at least 40, outcome `success`, and `step_up_satisfied` false. Zero events is `no_sample`. R-13 points at this control.

## Test of design

`tests/test_phase4_identity.py` inserts one successful event at score 40 without step-up and expects one violation. The same file denies a new device when the account has no factor, and it denies a login after five failures across three or more emails from the same address. Impossible travel is scored only when both addresses match configured prefixes for different regions.

## Test of operating effectiveness

The hosted service does not record these events yet. There is no hosted population to score. A pass requires events, and every high-risk success in that set must show step-up. An empty table must stay `no_sample`.

## Limits and follow-up

Unmapped IP addresses are unknown. They are not treated as travel. The per-account lockout is still in memory and is not this control. The check does not score denied or challenged attempts as violations.
