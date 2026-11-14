# SM-RP-01 — SAR drafts cite only the case events

**Date:** 2026-11-04
**Control owner:** Compliance (second line)
**Status:** Design tested. No hosted draft population exists yet.

## Risk and control

A narrative that cites an event the case does not contain, or that states a filing decision, is R-23. The drafter is a fixed template. It lists the case id, the case summary, and the case event ids, and it ends by saying filing is outside the draft. The verifier rejects a cited set that is not exactly the case event ids, an extra `cash-`, `trade-`, `order-`, or `cancel-` token, and a filing phrase. SM-RP-01 re-reads stored drafts. Zero drafts is `no_sample`.

## Test of design

`tests/test_phase6_pack.py` scores an empty book as `no_sample`. An auditor receives HTTP 403. A compliance officer's draft for an AML case with `cash-1` and `cash-2` contains those ids and does not contain `cash-9` or a filing phrase. The control then passes. Appending `cash-9` to the stored narrative makes the control fail.

## Test of operating effectiveness

There is no hosted `sar_drafts` table. No external language model was called. The template is not an activation and it does not decide to file.

## Sample

The design sample is one stored draft and one tampered draft in sqlite. There is no hosted sample.

## Limits and follow-up

The verifier looks for one `Events cited:` line and for event-id tokens. A filing decision written with different words can pass the phrase list. Deploy migration `d5e9f2b8c047` before hosted drafts can exist.
