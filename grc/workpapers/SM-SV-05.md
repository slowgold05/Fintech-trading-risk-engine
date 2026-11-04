# SM-SV-05 — Surveillance cases stay inside their SLA

**Date:** 2026-11-03
**Control owner:** Trading Surveillance (first line)
**Status:** Design tested. No hosted case population exists yet.

## Risk and control

A surveillance alert that nobody reviews can sit open after its due time. SM-SV-05 reads every surveillance case. It fails when an open case is past `due_at`, or when `closed_at` is later than `due_at`. Zero cases is `no_sample`. R-17 points at this control. The four detection rules are models, not substitutes for this check.

## Test of design

`tests/test_surveillance.py` inserts an open case due on 2026-11-01 and scores it on 2026-11-03 as a breach. Closing it on 2026-11-02 is still late. Closing it before the due time clears the breach. The same test file checks that the subject cannot close their own case and that a live wash scan opens one case only after the rule is active.

## Test of operating effectiveness

There is no hosted surveillance case. The control has not been run against the Lightsail database. A pass requires a population of cases that were all closed on time. An empty book must stay `no_sample`.

## Limits and follow-up

The check does not judge whether a disposition was correct. It only compares the clock with the due time stored when the case opened. Deploy migration `a8d3c1e4b672` before this control can see hosted rows.
