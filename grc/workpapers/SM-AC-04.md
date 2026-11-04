# SM-AC-04 — Authenticator enrollment

**Date:** 2026-11-04
**Control owner:** Security Operations (second line)
**Status:** Design tested. There is no hosted MFA population.

## Risk and control

An account that can sign in with only a password misses the MFA expectation in NYDFS 500.12. SM-AC-04 counts application accounts and confirmed authenticator rows. Every account must have a confirmed factor. Zero accounts is `no_sample`. Any account without a factor is a fail. R-18 points at this control.

## Test of design

`tests/test_phase4_identity.py` starts from an empty book and expects `no_sample`. After one account is inserted with no factor, the same check is a fail. Enrollment, a reused code, and a later code are covered by the login test in that file. The secret is not stored in plaintext.

## Test of operating effectiveness

The hosted database has no authenticator table and no enrolled accounts. This control has not been run there. After a deploy, an unenrolled book fails the control. That result is correct. `MFA_REQUIRED` stays false until every account enrolls.

## Limits and follow-up

The check does not prove that a person holds the device. It only proves a confirmed factor row exists. Rotating `JWT_SECRET` makes stored secrets unreadable. Passkey signing is not part of this control.
