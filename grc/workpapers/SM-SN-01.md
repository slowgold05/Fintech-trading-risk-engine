# SM-SN-01 — Sanctions screens cover names and withdrawals

**Date:** 2026-11-04
**Control owner:** Security Operations
**Status:** Design tested. No hosted screening population exists yet.

## Risk and control

A paper withdrawal to a sanctioned name is R-21. SM-SN-01 requires a clear onboarding screen for every account with a non-empty legal name, and a clear payout screen on every withdrawal. The normalized screen subject must match the stored name. Zero named accounts and zero withdrawals is `no_sample`.

## Test of design

`tests/test_phase5_aml.py` rejects registration of `Test Sanctioned Person` with HTTP 403 and creates no user. A withdrawal with no legal name is HTTP 403. Putting that sanctioned name on an existing account is HTTP 403 and leaves `full_name` empty. Saving `Ada Trader` and withdrawing $25.00 then scores the control as `pass`. The blocked name comes from `grc/sanctions/fixture.yaml`. That file is not an OFAC or OpenSanctions list.

## Test of operating effectiveness

The hosted service has no `full_name` column and no sanctions screens. `YENTE_URL` is empty in this working tree and is not set on the running image. A pass on the fixture is not evidence that a real list was screened.

## Sample

The design sample is one blocked registration, one blocked rename, and one clear withdrawal in sqlite. There is no hosted sample.

## Limits and follow-up

Screening fails closed when yente is configured and the call fails. That path is unit-covered by the service contract and was not exercised against a running yente. No Docker yente service was added.
