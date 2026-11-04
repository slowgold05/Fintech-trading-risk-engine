# SM-AU-01 — Auditor evidence bundle hash

**Date:** 2026-11-04
**Control owner:** Compliance (second line)
**Status:** Design tested. No hosted evidence population was exported.

## Risk and control

An auditor bundle that does not match the stored payload is R-24. `GET /compliance/evidence-export` zips the latest `control_evidence` payload per control and a `MANIFEST.json` of sha256 values. SM-AU-01 fails when a stored sha256 does not match the payload. Zero evidence rows is `no_sample`. The zip is not committed under `grc/evidence/`.

## Test of design

`tests/test_phase6_pack.py` scores an empty book as `no_sample`. One row whose sha256 matches the payload scores `pass`, and the zip entry equals that payload. Replacing the stored digest with 64 zeroes scores `fail`.

## Test of operating effectiveness

The hosted database does not have the evidence table yet. The live console still shows `not_run`. This workpaper does not treat a sqlite row as operating effectiveness.

## Sample

The design sample is one evidence row in sqlite. It was not selected from the hosted database.

## Limits and follow-up

The check covers the latest row per control. Older rows are not re-hashed. A copy of the zip outside the database is still open. R-08 stays unmapped.
